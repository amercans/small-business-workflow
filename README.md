# small-business-workflow

A self-hosted employee workflow panel for small businesses. Staff request leave, claim expenses and ask for advances or purchases; managers approve them, track equipment and invoices, and see where the money goes. It runs entirely on your own Cloudflare account (Workers, D1 and R2).

The interface ships in English and Turkish, and new languages are added with a single file.

## Features

- **Requests**: annual, excuse, sick and unpaid leave (full day, half day or hours), expense claims with receipts, cash advances and their settlement, purchase requests and business travel.
- **Approval flow**: configurable approval rules per request type and role, automatic approval for chosen roles, one-click approve/reject links in email (single use, 7 days), and an audit log for every decision.
- **Leave calendar**: a team calendar that shows who is away without revealing the type of leave, plus public holidays for the configured country.
- **Leave statements**: yearly leave balances that employees review and confirm in the panel.
- **Inventory**: physical equipment and software seats, assignment to people, handover confirmation and returns.
- **Invoices**: incoming and outgoing invoices with configurable VAT rates, TRY/USD/EUR amounts, attachments, approval of incoming invoices and links to equipment, software and jobs.
- **Currencies**: a base currency (TRY, USD or EUR); expenses and invoices can be entered in any of the three and reports are converted to the base currency with daily rates from the Central Bank of the Republic of Türkiye (TRY base) or the European Central Bank (USD or EUR base), with manual rates as a fallback.
- **Agreements**: contracts with renewal reminders.
- **Jobs**: a simple record of client work with admin-defined job types, people and revenue shares (amounts visible to management only).
- **Reports and overview**: monthly income, costs and margin, leave and expense reports, Excel exports.
- **Accounting email (optional)**: approved requests and invoices can be forwarded to an external accountant, with a monthly invoice bundle.
- **Accounts**: password, email magic-link or both; a fail-closed first-administrator setup; email verification; admin approval or invite links for everyone else; password reset by email or by an admin-generated link.

## Localization

- English is the default. Each user picks a language from the menu; before sign-in the language comes from a cookie or the browser's `Accept-Language`.
- Dates, numbers and money are formatted with `Intl` for the active language.
- Notification emails are written in each recipient's language.
- Turkey support is built in as a feature, not a requirement: Turkish public holidays (`HOLIDAY_COUNTRY=TR`), Turkish lira as base currency with automatic USD/EUR rates from the Central Bank of the Republic of Türkiye, and a KVKK-style privacy notice template. Other countries can set `HOLIDAY_COUNTRY=NONE`, another `CURRENCY`, and use the GDPR-style English templates.

See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language) for adding a language.

## Legal templates

The workplace policy, privacy notice and acknowledgement form are **templates**. They use placeholders such as `{{COMPANY_NAME}}` that are filled from configuration. The app shows a notice next to them, and you should have them reviewed by your own legal counsel before use.

## Stack

TanStack Start (React 19) on Cloudflare Workers, D1 (SQLite) for data, R2 for files, Tailwind CSS 4, Zod, Vitest. No external auth provider is needed.

## Local development

Requirements: Node.js 22.5 or newer.

```bash
npm ci
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
npm run db:reset
npm run dev
```

Open http://localhost:3000. `db:reset` creates a local database with fictional demo data; the sign-in details of the demo accounts are printed at the end. To try the first-time setup instead, apply the migration to an empty database (`npm run db:migrate:local`), keep `ADMIN_EMAIL` in `.dev.vars`, and register with that address at `/register`. In development the verification link is printed in the terminal.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run typecheck` | Generates the route tree and runs `tsc` |
| `npm test` | Runs the Vitest suite |
| `npm run build` | Production build |
| `npm run verify` | Type check, tests, build and a build-output check |

## Deploying to Cloudflare

1. Create the database and the file bucket:

   ```bash
   npx wrangler d1 create small-business-workflow
   npx wrangler r2 bucket create small-business-workflow-files
   ```

2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` (it is git-ignored) and fill in the placeholders: the D1 `database_id`, the R2 bucket name, your domain in `routes` and `PANEL_URL`, and two unique integers for the rate-limit `namespace_id`s. Review the `vars` described below.

3. Apply the schema:

   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```

4. If you want email, set `MAIL_MODE` to `resend`, set `MAIL_FROM` to an address on a domain verified with [Resend](https://resend.com), and add the API key as a secret:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

5. Deploy:

   ```bash
   npm run deploy
   ```

6. Create the first administrator. Set `ADMIN_EMAIL` to your address before deploying, then open `https://<your-domain>/register`, register with that address and open the verification link you receive; you choose your password on that page. Alternatively set a one-time setup token with `npx wrangler secret put SETUP_TOKEN` and enter it on the registration form; you are taken straight to a set-password page. Remove the secret afterwards. If neither is set, registration stays closed.

7. Everyone who registers later confirms their email address (and sets a password) through the emailed link and then waits for an administrator's approval, or you can send invite links from **Users**.

## Sign-in modes

| `AUTH_MODE` | How people sign in | Needs email delivery | Notes |
| --- | --- | --- | --- |
| `password` (default) | Email and password | No (recommended for verification and resets) | Password hashing uses noticeable CPU time per sign-in |
| `magic_link` | A single-use link emailed to them, valid for 15 minutes | Yes (`MAIL_MODE=resend`) | No passwords to store or reset; sign-in depends on the mailbox |
| `both` | Either of the above | Yes, for the link option | Users who prefer links can skip the password after registering |

If a mode that needs email is selected without working email delivery, the Worker logs a configuration error at startup and the sign-in page explains that link sign-in is unavailable.

## Cost and password hashing

The app uses Workers, D1, R2, Cron Triggers and the Rate Limiting binding. Passwords are hashed with PBKDF2-SHA256. OWASP currently recommends far more iterations than Workers allows; 100,000 is the Workers maximum and the default. `PASSWORD_ITERATIONS` accepts values from 80,000 to 100,000, and existing hashes are upgraded automatically on the next successful sign-in after you change it. Each password sign-in costs CPU time roughly in proportion to the iteration count, which can exceed the per-request CPU limit of the Workers Free plan; the Workers Paid plan has higher limits. `AUTH_MODE=magic_link` avoids password hashing altogether. Check Cloudflare's current pricing and limits pages for details.

## Configuration

All settings are Worker variables in `wrangler.jsonc` (`vars`), except `RESEND_API_KEY`, which is a secret.

| Variable | Default | Description |
| --- | --- | --- |
| `APP_NAME` | `Business Workflow` | Name shown in the interface and emails |
| `PANEL_URL` | request origin | Public URL used in email links. Falling back to the request's `Host` is only safe when the Worker is reached directly through a Cloudflare Workers custom domain; behind any other proxy, set `PANEL_URL` |
| `DEFAULT_LOCALE` | `en` | Language when nothing else decides it (`en`, `tr`) |
| `CURRENCY` | `TRY` | Base currency for amounts and reports |
| `TIME_ZONE` | `Europe/Istanbul` | Time zone for "today", reminders and timestamps |
| `HOLIDAY_COUNTRY` | `TR` | Public holiday calendar (`TR` or `NONE`) |
| `BOOKS_START_DATE` | empty | Invoices dated before this `YYYY-MM-DD` date are kept for reference but excluded from accounting and reports |
| `ALLOWED_EMAIL_DOMAIN` | empty | If set, only this email domain can register (a convenience filter, not a security control) |
| `ADMIN_EMAIL` | empty | Address allowed to create the first administrator account (after email verification) |
| `SETUP_TOKEN` | secret | Alternative one-time token for creating the first administrator |
| `AUTH_MODE` | `password` | `password`, `magic_link` or `both` |
| `PASSWORD_ITERATIONS` | `100000` | PBKDF2 iterations, 80,000 to 100,000 |
| `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_REGISTRATION`, `COMPANY_CONTACT_EMAIL` | empty | Fill the legal templates |
| `MAIL_MODE` | `log` | `none`, `log` (write to the Worker log) or `resend` |
| `MAIL_FROM` | empty | Sender address for `resend` |
| `MAIL_ONLY` | empty | Comma-separated allow list; when set, email goes only to these addresses (useful for staging) |
| `ACCOUNTING_TO`, `ACCOUNTING_CC`, `ACCOUNTING_REPLY_TO` | empty | Accounting email recipients; empty `ACCOUNTING_TO` turns the feature off |
| `ACCOUNTING_SALUTATION` | empty | Greeting name used in accounting emails |
| `ACCOUNTING_LOCALE` | `en` | Language of accounting emails |
| `RESEND_API_KEY` | secret | Resend API key |

`CURRENCY` accepts `TRY`, `USD` or `EUR`. VAT rates, approval rules and job types are edited by an administrator in the panel.

## Roles

| Role | Can do |
| --- | --- |
| Employee | Own requests; optionally upload incoming invoices or edit jobs (per-user flags) |
| Manager | Everything an employee can, plus all requests, inventory, invoices, agreements, jobs and reports |
| Approver | Management access plus approving requests and incoming invoices, and marking payments |
| Owner | Management access; approves the approver's own requests |

The admin flag is separate from the role and allows user management and settings. Who approves which request type for which requester role, and which roles are approved automatically, is set under **Settings**. By default employees' and managers' requests go to an approver, the approver's own requests go to the owner, and the owner's requests are approved automatically. If nobody can approve a request (for example the approver role is empty), it stays pending and a warning is logged until an administrator assigns the role. Details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Security

See [SECURITY.md](SECURITY.md) for the security model and how to report a vulnerability.

## License

[MIT](LICENSE)

## Author

Ahmet Mercan (@amercans)
