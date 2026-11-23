# Architecture

This document explains how the app is put together and why. For setup, see the [README](README.md).

## Overview

```
Browser ──► Cloudflare Worker (src/server.ts)
              ├─ public routes: /robots.txt, /favicon.svg
              ├─ auth pages: /login /register /forgot /reset/:token /logout /lang /account/password
              ├─ email approval links: /a/:token
              ├─ files and exports: /files/*, /exports/*   (session required)
              └─ TanStack Start app (SSR + server functions)  (session required)
                    │
                    ├─ D1  (all data, single SQLite database)
                    └─ R2  (receipts, invoices, contracts, medical certificates)
Cron ──► the same Worker's scheduled() handler
```

Every request, including static assets, goes through the Worker first (`run_worker_first`), so nothing is served without a session except the public and auth routes.

## Source layout

| Path | Contents |
| --- | --- |
| `src/server.ts` | Worker entry: routing, security headers, session check, locale, cron jobs |
| `src/server/auth/` | Passwords, sessions, invites and resets (`accounts.ts`), cookies/CSRF/rate limits (`http.ts`), server-rendered auth pages (`pages.ts`, `routes.ts`), the `authorize()` permission function |
| `src/server/services/` | Business logic: requests, approvals, inventory, invoices, jobs, reports, compliance |
| `src/server/db/` | D1 helpers, ULIDs, audit log, assertion helper, an in-memory SQLite adapter for tests |
| `src/server/notify.ts`, `accounting.ts` | Email outbox and accounting outbox |
| `src/data/` | TanStack server functions called by the UI; each one starts with the `authed` middleware |
| `src/routes/`, `src/components/` | React UI |
| `src/lib/` | Shared, side-effect-free logic and Zod schemas used on both client and server |
| `src/i18n/` | Translation layer, dictionaries and `Intl` formatting helpers |
| `src/legal/` | Policy, privacy notice and acknowledgement templates per language |
| `src/holidays/` | Public holiday calendars per country |
| `src/config/` | Brand defaults and runtime configuration shared by client and server |
| `migrations/` | D1 schema |
| `scripts/` | Demo seed generator and build-output check |

## Authentication

The app has its own accounts. `AUTH_MODE` selects password sign-in, email magic links or both.

- **First administrator (fail-closed).** While no active administrator exists, registration is refused unless `ADMIN_EMAIL` or `SETUP_TOKEN` is configured. A registration for `ADMIN_EMAIL` is stored as a pending owner account without a password and becomes active when the emailed verification link is opened and a password is set there. A registration with the correct setup token becomes active immediately and is sent straight to a one-hour set-password page: the token proves knowledge of the setup secret, not of the mailbox, so no password from the registration form is stored on either path. The activating statements check that no active administrator exists, so a second bootstrap cannot succeed.
- **Registration and verification.** Registration forms never store a password (except invite registrations, where the admin-issued link is the secret). Later registrations are `pending` with the employee role and receive a verification link (single use, 24 hours); opening it shows a form (or, with `AUTH_MODE=magic_link`, a confirmation) and only the POST consumes it and sets the password. A new registration for an address whose earlier registration is still unverified replaces that row and sends a fresh link, so a squatter cannot lock out the real owner. An administrator approves (and sets the role) or rejects them on the Users screen; unverified accounts cannot be approved while email delivery works, and need an explicit confirmation when it does not. Registering an address that already exists returns the same response as a new registration and performs the same hashing work, so the form cannot be used to discover accounts. If `ALLOWED_EMAIL_DOMAIN` is set, other domains are refused.
- **Invites.** Admins create invite links for a role, optionally bound to one email address (which then counts as verified and cancels any unverified pending registration for it). An invited registration is active immediately. The token is consumed in the same batch as the user insert.
- **Passwords.** PBKDF2-SHA256 with `PASSWORD_ITERATIONS` (default and maximum 100,000, the WebCrypto limit on Workers) and a 16-byte salt. The stored value is `pbkdf2-sha256$<iterations>$<salt>$<hash>`; a successful sign-in re-hashes when the stored count differs from the configured one. Verification runs the full derivation even for unknown users.
- **Magic links.** A single-use link valid for 15 minutes. Opening it shows a confirmation button; the token is consumed only by that POST, so mail scanners that prefetch links cannot use it up.
- **Sessions.** A 32-byte random token is sent as a cookie; the `sessions` table stores only its SHA-256 hash. Sessions expire after 30 days and are extended at most once a day while in use. Every request re-checks that the user is still active and allowed to sign in; deactivating a user deletes their sessions, and changing or resetting a password also cancels their email approval links and any open magic or reset links.
- **Password reset.** With email configured, `/forgot` sends a single-use link valid for one hour. Without email, an admin generates a reset link (valid 24 hours) on the Users screen. Issuing a new link invalidates older ones; admins can revoke unused invite and reset links.
- **Request handling.** Auth forms are server-rendered HTML. Bodies, including the email approval page's form, are read with a byte counter and cut at 10 KB. State-changing requests, including the language switch, must come from the panel's own origin. Auth endpoints are limited per IP and per IP-and-email pair through the `AUTH_LIMIT` binding; the email approval links use `ACTION_LIMIT`. Missing bindings and incomplete auth or email configuration are logged as warnings on the first request.
- **Development.** With `DEV_AUTH=1` in `.dev.vars`, a development build on `localhost` can impersonate seeded users through a small switcher. The module is loaded only inside `import.meta.env.DEV` branches, and `scripts/check-dist.mjs` fails the build if any trace of it reaches the output.

## Authorization

`authorize(user, action)` in `src/server/auth/authorize.ts` is the single, pure permission function. It denies by default and returns "not found" rather than "forbidden" when revealing a record's existence would leak information. Services call `must()` before reading or writing; the UI uses the matching helpers in `src/lib/permissions.ts` only to hide what the server would refuse anyway.

Roles are employee, manager, approver and owner; managers, approvers and the owner form the management group. Approval routing is data, not code: the `approvals` setting maps each request type and requester role to an approving role and lists the roles whose requests are approved automatically. A requester can never decide their own request. If no other active user holds the configured approving role the request goes to the owner; if there is no such owner either, it stays pending and a warning is logged. Nothing is approved automatically because approvers are missing. The admin flag is independent of the role and grants user management, settings and the audit log.

## Data integrity

D1 has no row-level security, so the schema itself guards important invariants:

- the audit log and policy acceptances are append-only;
- most business tables reject `DELETE` (records are archived or cancelled instead);
- request status transitions, draft-only edits and approval stages are enforced by triggers;
- business rules that must hold across several statements are written as `assertions`: a statement inserts into the `assertions` table when a rule is broken, a trigger aborts the whole batch, and the service maps the error code to a message.

All writes for one user action go in a single `db.batch()` together with their audit entries, so they succeed or fail together. Files are written to R2 before the batch; if the batch fails, the new objects are removed.

## Email

Notification emails go through an outbox table. A message stores the template and raw parameters rather than rendered text; it is rendered at delivery time in the recipient's language. Delivery runs right after a write (without delaying the response) and every 15 minutes from cron, with claiming, retries and expiry so a message is not sent twice.

Approval emails include one-click approve and reject links. Each link is a hashed, single-use token bound to one record and one person, valid for 7 days. The page it opens shows only what is needed to decide and records the decision with IP address and browser in the audit log.

Accounting emails, if configured, are rendered in `ACCOUNTING_LOCALE` and include attachments; at the end of each month approved incoming invoices are bundled into a zip file.

Providers: `MAIL_MODE=log` writes to the Worker log, `resend` sends through the Resend HTTP API, `none` disables sending.

## Internationalization

- Dictionaries live in `src/i18n/lang/`, one file per language. English is the reference: its key tree defines the `Messages` type, so another language with a missing or extra key fails the type check. `MessageKey` is a union of every dotted key, so `t('…')` calls are checked too.
- `t()` reads the current locale. On the server the locale is stored per request in an `AsyncLocalStorage` (user preference, then the `lang` cookie, then `Accept-Language`, then `DEFAULT_LOCALE`). On the client it is set from the session before the app renders. Code that needs a specific language, such as emails to another person, uses `forLocale(locale)`.
- Nothing translated is computed at module load time; label maps are functions or getters, and Zod messages are functions, so the same module serves different languages in the same Worker.
- Dates, numbers and money use `Intl` with the locale's tag, the configured time zone and the base currency.

## Localization of business rules

- **Holidays** come from `src/holidays/<country>.ts`, selected with `HOLIDAY_COUNTRY`. Leave day counts skip weekends and holidays, and half-day holiday eves count as half days.
- **Currency.** Amounts are stored as integers in minor units; every expense line and invoice keeps its original currency (TRY, USD or EUR), the rate used and the converted amount in the base currency (`CURRENCY`), which reports use. Rates come from one provider interface: the Central Bank of the Republic of Türkiye when the base is TRY, the European Central Bank's daily reference rates (with cross rates) when the base is USD or EUR. If fetching fails, rates can be entered manually.
- **VAT rates** and the stored exchange rates can only be changed by administrators.
- **Job types** are an administrator-edited list with a generic default set.
- **Books start date.** Invoices dated before `BOOKS_START_DATE` stay visible for reference but are excluded from accounting emails and financial reports, which helps when importing older records.
- **Legal templates** are per language, filled from `COMPANY_*` variables, and always shown with a notice that they are templates.

## Scheduled jobs

| Cron | Work |
| --- | --- |
| every 15 minutes | deliver queued emails; fetch missing exchange rates |
| daily 06:00 UTC | reminders (pending approvals, expiring agreements, software renewals), expired session cleanup, exchange rates |
| 14:00 UTC on days 28–31 | on the last day of the month, queue the monthly invoice bundle for accounting |

## Testing

Vitest runs against an in-memory SQLite database created from the real migration (`src/server/db/testing.ts`), with the same batch semantics as D1. Suites cover authorization for every role, request and approval flows, invoices, jobs, reports, email rendering and delivery, authentication, and static checks over the source (every server function uses `authed`, SQL stays in the server layer, the Worker entry exports only its handler).
