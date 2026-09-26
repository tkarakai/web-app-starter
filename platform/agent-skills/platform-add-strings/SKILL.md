---
name: platform-add-strings
description: Use to add or change user-visible text - UI labels, messages, errors, placeholders, aria labels - as translated strings in the app's own message namespace (packages/messages), in every locale the app ships.
---

# Add translated strings

User-visible text in `web`, `landing` and `landing-static` always comes from locale messages,
never from literals in components: labels, headings, errors, placeholders, accessible names and
metadata. `admin` is English-only and reads the platform's English catalogue.

Background: `platform/docs/i18n-architecture.md` (usage, ICU syntax, formatting).

## Where strings live

- **Your strings:** `packages/messages/<locale>.json` (`@repo/messages`, app-owned), one file per
  locale your apps ship: `i18n.locales` in `app.config.ts` (the reference apps ship all 15:
  `en`, `ar`, `cs`, `de`, `es`, `fr`, `he`, `hu`, `it`, `ja`, `nl`, `pl`, `pt`, `ru`, `zh`). `en`
  is the source of truth.
- **Platform strings:** `platform/packages/i18n/messages/<locale>.json` hold the platform's
  namespaces (`common`, `theme`, `language`, `offline`, `auth`, `errors`, `passwordStrength`,
  `forbidden`, `timezones`) in all 15 locales. Platform zone: never edit them.
- **Your wording for a platform string:** `packages/messages/overrides.json`, keyed by locale and
  then the platform key path; it is deep-merged over the platform's messages.
- The loader (`loadMessages` in `@web-app-starter/i18n`) merges the three at load time, so
  components read any namespace the same way: `useTranslations("<namespace>")` (client) or
  `await getTranslations("<namespace>")` (server).
- `bun run check:i18n` requires every key of your `en.json` in each shipped locale, fails on a
  namespace that clashes with a platform one, and flags overrides of platform keys that no longer
  exist. `apps/web/qa/tests/message-catalogues.test.ts` checks ICU arguments match across locales.

## Rules

1. **Use your own namespace** for a feature: a new top-level key in `packages/messages/*.json`
   named after it (e.g. `help`, `bookmarks`). Never add keys to a platform namespace, and never
   edit `platform/packages/i18n/messages/`; reuse platform keys where they fit (`common.save`,
   `common.cancel`). Adding an app string touches no platform file.
2. **Add every key to every shipped locale in the same change**, translated properly. Never copy
   English into another locale as a placeholder, and never leave a shipped locale out: the check
   fails.
3. **Keep ICU arguments identical** across locales: `{count}` in English means `{count}` in every
   translation. Plurals use `{count, plural, one {# item} other {# items}}`; each language uses
   its own plural categories (e.g. Polish and Russian need `few` and `many`, Japanese and Chinese
   only `other`), with the same argument name.
4. **Append the namespace at the end** of each file and keep the existing 2-space indentation and
   trailing newline, so diffs stay small and upgrades merge cleanly.
5. **Backend errors** are codes, not text: a Convex function throws `new Error("BOOKMARK_NOT_FOUND")`;
   the code's message goes under your namespace (e.g. `bookmarks.errors.notFound`) and the web app
   maps the code to it in `APP_ERROR_KEYS` (`apps/web/src/lib/app-error-keys.ts`), which the
   platform's `ConvexErrorToast` reads.
6. **Never write the product name** into a message. Use a `{productName}` argument and pass
   `appConfig.identity.productName` from `@web-app-starter/app-config`: `t("intro", { productName })`.
7. **To reword a platform string**, add it to `overrides.json` for each shipped locale, e.g.
   `{ "en": { "auth": { "signIn": { "title": "Log in" } } } }`; never copy the platform
   namespace into your files.
8. **Admin** doesn't use locale routing and is English-only: it imports platform strings from
   `@web-app-starter/i18n/messages/en.json` and never reads app namespaces.

## Steps

1. Write the English strings in `packages/messages/en.json` under your namespace.
2. Add the same keys, translated, to the other shipped locales' files in `packages/messages/`.
3. Check:

   ```bash
   bun run check:i18n
   bun run --cwd apps/web test
   ```

4. Use the strings: `const t = useTranslations("help");` then `t("title")`, or
   `t("linkCount", { count })` for ICU arguments.
5. In component tests, render with the real catalogues (platform and app) so a missing key fails:

   ```tsx
   import platformEn from "@web-app-starter/i18n/messages/en.json";
   import appEn from "@repo/messages/en.json";
   const en = { ...platformEn, ...appEn };
   render(<NextIntlClientProvider locale="en" messages={en}><HelpContent /></NextIntlClientProvider>);
   ```

## Worked example

**Task:** add the strings for a Help page in the web app: a title, a one-line description, a
"Contact support" link label, and a line that says how many guides exist.

`packages/messages/en.json`, appended as the last namespace:

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

…and likewise for the remaining shipped locales. **Done when** `bun run check:i18n` and
`bun run --cwd apps/web test` pass, and the diff touches `packages/messages/` (every shipped
locale's file) and nothing under `platform/`.
