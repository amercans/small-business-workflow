# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **private vulnerability reporting**: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for security problems.

Include the affected version or commit, steps to reproduce, and the impact you expect. You should get an acknowledgement within a few days. Fixes are released as soon as practical and credited in the changelog unless you prefer otherwise.

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## Security model

- **First administrator (fail-closed).** Registration is closed until `ADMIN_EMAIL` (a variable) or `SETUP_TOKEN` (a secret) is set. While no active administrator exists, only a registration for `ADMIN_EMAIL` (activated after its email address is verified) or one presenting the correct setup token can become the administrator. Every other registration is refused during setup.
- **Email verification.** Registration forms do not accept a password. Self-registered accounts receive a single-use verification link valid for 24 hours; opening it shows a form, and only submitting that form verifies the address and sets the password. A newer registration for a still-unverified address replaces the older one. An unverified account cannot be approved while email delivery is configured; when the panel cannot send email, the Users screen marks the account as unverified and the administrator has to confirm the approval explicitly. Creating an invite for an address cancels any unverified pending registration for that address.
- **Passwords** are hashed with PBKDF2-SHA256 through WebCrypto with a 16-byte random salt per user and compared in constant time. The stored hash records the algorithm and iteration count (`PASSWORD_ITERATIONS`, default 100,000, which is the maximum Workers allows). Hashes made with a different count are upgraded on the next successful sign-in. Registration does the same hashing work whether or not the address already exists.
- **Magic links** (`AUTH_MODE=magic_link` or `both`) are single-use, valid for 15 minutes, and need a confirmation click so that link scanners cannot consume them.
- **Sessions** use a 32-byte random token in an `HttpOnly; Secure; SameSite=Lax` cookie (`__Host-` prefixed over HTTPS). Only the SHA-256 hash of the token is stored. Sessions last 30 days and slide forward with use. Signing out, changing or resetting a password, or deactivating a user removes the sessions; a password change or reset also cancels the user's pending email approval links and open magic and reset links.
- **Invites and password resets** use single-use tokens stored as hashes. Invites expire after 7 days, emailed reset links after 1 hour and admin-generated reset links after 24 hours. Administrators can revoke unused invite and reset links.
- **CSRF**: every state-changing request, including the language switch, must come from the panel's own origin (`Origin`, `Sec-Fetch-Site` or `Referer`).
- **Rate limiting**: sign-in, registration, magic links and password reset are limited per IP address and per IP-and-email pair with the Workers Rate Limiting binding. If the binding is missing the Worker logs a warning.
- **Request size**: auth and email-approval form bodies are read with a byte counter and rejected above 10 KB regardless of the `Content-Length` header.
- **No account enumeration**: sign-in, registration, reset and magic-link responses do not reveal whether an email address is registered.
- **Authorization** is checked on the server for every server function, file download and export by a single `authorize()` function that denies by default.
- **Database integrity**: audit logs are append-only, most business records cannot be deleted, and status transitions are enforced by triggers.
- **Headers**: a nonce-based Content Security Policy in production, `X-Frame-Options: DENY`, `nosniff`, HSTS and `noindex`.

### About `ALLOWED_EMAIL_DOMAIN`

Restricting registration to a domain only limits which addresses can be typed into the form. On its own it proves nothing about who controls the mailbox. The protection comes from email verification and administrator approval; treat the domain setting as a convenience filter, not as an access control.

## Operator responsibilities

- Keep `RESEND_API_KEY` in Worker secrets, never in `wrangler.jsonc` or the repository.
- Keep `SETUP_TOKEN` in Worker secrets and remove it once the first administrator exists.
- Configure real email delivery (`MAIL_MODE=resend`) in production so that addresses are verified before approval.
- Never set `DEV_AUTH=1` outside local development; the development identity switcher only works on `localhost` builds.
