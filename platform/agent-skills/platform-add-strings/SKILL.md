---
name: platform-add-strings
description: Use to add or change user-visible text - UI labels, messages, errors, placeholders, aria labels - as translated strings in the app's own message namespace, in every locale the platform ships.
---

# Add translated strings

User-visible text in `web`, `landing` and `landing-static` always comes from locale messages,
never from literals in components: labels, headings, errors, placeholders, accessible names and
metadata. `admin` is English-only and reads the English catalogue.

Background: `platform/docs/i18n-architecture.md` (usage, ICU syntax, formatting).

## Where strings live

- `packages/i18n/messages/<locale>.json`, one file per locale: `en` (the source of truth), `ar`,
  `cs`, `de`, `es`, `fr`, `he`, `hu`, `it`, `ja`, `nl`, `pl`, `pt`, `ru`, `zh`. The list is
  `locales` in `packages/i18n/src/config.ts`.
- Each file is one JSON object of **namespaces** (`common`, `auth`, `dashboard`, ...), nested
  objects of keys. Components read a namespace with `useTranslations("<namespace>")` (client) or
  `await getTranslations("<namespace>")` (server).
- `apps/web/qa/tests/message-catalogues.test.ts` requires every key in `en.json` to exist in
  every other locale, with the same ICU arguments. Extra keys are allowed.

## Rules

1. **Use your own namespace** for a feature: a new top-level key named after it (e.g. `help`,
   `bookmarks`). Don't add keys to platform namespaces (`common`, `auth`, `errors`,
   `passwordStrength`, `timezones`, `theme`, `language`, `metadata`, `legal`, `offline`,
   `forbidden`); reuse their existing keys where they fit (`common.save`, `common.cancel`).
2. **Add every key to every locale in the same change**, translated properly. Never copy English
   into another locale as a placeholder, and never leave a locale out: the catalogue test fails.
3. **Keep ICU arguments identical** across locales: `{count}` in English means `{count}` in every
   translation. Plurals use `{count, plural, one {# item} other {# items}}`; each language uses
   its own plural categories (e.g. Polish and Russian need `few` and `many`, Japanese and Chinese
   only `other`), with the same argument name.
4. **Append the namespace at the end** of each file and keep the existing 2-space indentation and
   trailing newline, so diffs stay small and platform upgrades merge cleanly.
5. **Backend errors** are codes, not text: a Convex function throws `new Error("BOOKMARK_NOT_FOUND")`;
   the code's message goes under your namespace (e.g. `bookmarks.errors.BOOKMARK_NOT_FOUND`) and
   the web app maps it in `apps/web/src/lib/error-messages.ts`.
6. **Never write the product name** into a message. Use a `{productName}` argument and pass
   `appConfig.identity.productName` from `@web-app-starter/app-config`: `t("intro", { productName })`.
7. **Admin** doesn't use locale routing: import what it needs from `@web-app-starter/i18n/messages/en.json`.

## Steps

1. Write the English strings in `packages/i18n/messages/en.json` under your namespace.
2. Add the same keys, translated, to the other 14 files.
3. Check the JSON parses and the catalogue test passes:

   ```bash
   bun run --cwd apps/web test
   ```

4. Use the strings: `const t = useTranslations("help");` then `t("title")`, or
   `t("linkCount", { count })` for ICU arguments.
5. In component tests, render with the real catalogue so a missing key fails:

   ```tsx
   import en from "@web-app-starter/i18n/messages/en.json";
   render(<NextIntlClientProvider locale="en" messages={en}><HelpContent /></NextIntlClientProvider>);
   ```

## Worked example

**Task:** add the strings for a Help page in the web app: a title, a one-line description, a
"Contact support" link label, and a line that says how many guides exist.

`en.json`, appended as the last namespace:

```json
  "help": {
    "title": "Help",
    "description": "Guides and ways to reach us.",
    "contactSupport": "Contact support",
    "guideCount": "{count, plural, one {# guide} other {# guides}}"
  }
```

`de.json`:

```json
  "help": {
    "title": "Hilfe",
    "description": "Anleitungen und Wege, uns zu erreichen.",
    "contactSupport": "Support kontaktieren",
    "guideCount": "{count, plural, one {# Anleitung} other {# Anleitungen}}"
  }
```

`pl.json` (Polish needs `few` and `many`):

```json
  "help": {
    "title": "Pomoc",
    "description": "Poradniki i sposoby kontaktu z nami.",
    "contactSupport": "Skontaktuj się z pomocą techniczną",
    "guideCount": "{count, plural, one {# poradnik} few {# poradniki} many {# poradników} other {# poradnika}}"
  }
```

…and likewise for the remaining locales. **Done when** `bun run --cwd apps/web test` passes and
`git diff --stat packages/i18n/messages` shows all 15 files changed.
