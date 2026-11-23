# Contributing

Thanks for helping. Bug reports, translations and focused pull requests are all welcome.

## Getting started

```bash
npm ci
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
npm run db:reset
npm run dev
```

Before opening a pull request, run:

```bash
npm run verify
```

This type checks, runs the tests, builds the app and checks the build output.

## Guidelines

- Keep pull requests small and focused on one change.
- Every user-facing string goes through the i18n layer (`t()` or `tn()` from `#/i18n`). Do not hard-code text in components, server responses or emails.
- Every server function must start with the `authed` middleware, and every permission decision goes through `authorize()` in `src/server/auth/authorize.ts`. A static test enforces the first rule.
- Database writes are batched together with their audit log entry. Schema changes go in a new numbered file in `migrations/`.
- Add or update tests in `src/**/*.test.ts` for behaviour you change. Tests run against an in-memory SQLite database built from the real migrations.
- The codebase does not use code comments; explain design decisions in `ARCHITECTURE.md` or in the pull request description instead.
- Use fictional data in tests and seeds (`example.com` addresses, made-up names and companies).

## Adding a language

A language is one file in `src/i18n/lang/`. To add German, for example, create `src/i18n/lang/de.ts`:

```ts
import { defineLanguage } from '../types'

export default defineLanguage({
  code: 'de',
  name: 'Deutsch',
  intl: 'de-DE',
  messages: {
    auth: { login: { title: 'Anmelden' } },
  },
})
```

`messages` holds the full dictionary with the same keys as `src/i18n/lang/en.ts`; the snippet above only shows its shape.

The file is picked up automatically: it appears in the language menu, can be chosen as `DEFAULT_LOCALE`, and is matched against the browser's `Accept-Language`. The `messages` object is checked against the English dictionary, so `npm run typecheck` fails until every key is translated and no unknown key is present.

Optionally pass `legal` with translated policy, privacy notice and acknowledgement templates (see `src/legal/`). Without it, the English templates are used.

Write translations the way a native speaker would phrase product copy rather than translating word for word. Placeholders such as `{name}` must be kept. Plural entries are objects with `one` and `other` (and any other categories `Intl.PluralRules` uses for the language).

## Adding a public holiday calendar

Holiday calendars live in `src/holidays/`. Add a file for the country (see `tr.ts`) and register it in `src/holidays/index.ts`; operators then select it with `HOLIDAY_COUNTRY`. Holiday names are i18n keys under `holidays`.

## Reporting bugs

Open an issue with steps to reproduce, what you expected and what happened. For security problems, follow [SECURITY.md](SECURITY.md) instead.
