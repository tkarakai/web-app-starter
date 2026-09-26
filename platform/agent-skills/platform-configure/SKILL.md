---
name: platform-configure
description: Use to set the app's product name, legal entity, support email, local ports, auth cookie prefix, local origins, brand (icons, design tokens, email look) or optional feature switches. All of these are edits to app.config.ts only.
---

# Configure the app

Every value an app is expected to change lives in the root **`app.config.ts`**, and nowhere
else. The platform reads it everywhere it needs one of these values: TypeScript through
`@web-app-starter/app-config`, shell scripts and CI through `platform/tooling/app-config.ts`, Better Auth and the
proxies through `@web-app-starter/auth/cookies`. So a configuration change is an edit to `app.config.ts`
and **no other file**. If a change seems to need another file, stop: either the value isn't
configuration (see "Not here" below) or the platform has a gap to report.

Reference: `platform/docs/development.md`, "App configuration".

## What goes where

| You want to change | Set in `app.config.ts` | Notes |
|---|---|---|
| Product name | `identity.productName` | Page titles, headers, TOTP issuer, email footer, `{productName}` in messages. Never write it into a message file (`packages/messages`) |
| Company name in footers | `identity.legalEntity` | |
| Support address | `identity.supportEmail` | |
| Local ports | `runtime.ports.<app>` | `landing`, `web`, `admin`, `storybook`, `landing-static`; integers 1024–65535, all different. Local origins (`http://localhost:<port>`) follow from them |
| Auth cookie prefix | `runtime.authCookiePrefix` | Letters, digits, `-`, `_`; starts with a letter or digit. Set a unique one when another Better Auth app shares the host (e.g. localhost). **Changing it signs every user out** |
| Icons | `brand.icons.svg`, `.ico`, `.appleTouchIcon` | Repository-relative paths to your files; copied into each app on dev and build |
| Colours and other design tokens | `brand.tokenOverrides` | `{ "--primary": "oklch(0.55 0.2 260)" }`; names from `platform/packages/design-system/tokens/` |
| Email look | `brand.email.lang`, `.palette.*` (hex colours), `.footerText` | |
| Optional features | `features.waitlist`, `.invitations`, `.announcements`, `.environmentBanner` | `false` hides the feature; its code stays and keeps receiving fixes |
| Languages shipped | `i18n.locales` | A subset of the platform's 15 (`allLocales` in `@web-app-starter/i18n`), including `en`. Each needs `packages/messages/<locale>.json`; `bun run check:i18n` says what's missing |

**Not here:** deployed URLs, Convex URLs and secrets are per-deployment environment variables
(`platform/AGENTS.md`, "Environment variables"); translated wording is in the message files
(`platform-add-strings`); `apps/demo` has its own settings.

## Steps

1. Edit `app.config.ts`. Keep the `satisfies AppConfig` check and the existing structure; don't add
   keys (unknown keys are rejected).
2. Validate and see the derived values:

   ```bash
   ./platform/tooling/node-ts.sh platform/tooling/app-config.ts shell
   ```

   It prints the `APP_CONFIG_*` variables, or the list of invalid settings.
3. Check that nothing else still holds the old value. For a product name, port or cookie prefix:

   ```bash
   git grep -n -F "<old value>" -- ':!app.config.ts' ':!platform/'
   ```

   Hits in your own code are bugs: read the value from `appConfig` instead of changing the
   literal. Hits in platform-owned code are platform gaps: report them, don't edit.
4. Run the checks:

   ```bash
   bun run lint && bun run typecheck
   bun run test && bun run test:unit
   ```

5. **Local environment.** Existing `apps/*/.env.local` files are never overwritten. After
   changing ports, delete the `.env.local` files of landing and landing-static (they hold local
   URLs) or fix their URLs by hand, then restart with `bun run dev:stop && bun run dev`. The dev
   script updates Convex's `SITE_URL` for the new origins. After changing the cookie prefix, sign
   in again.
6. **Deployments.** Ports and the cookie prefix are local-development and app-wide values; a new
   cookie prefix reaches deployments with the next deploy and signs users out there too. Say so
   in the PR description.

## Worked example

**Task:** the product is called "Acme Notes", run by "Acme Inc." with support at
`help@acme.test`. Move the local ports to 4000–4004 so it can run beside another app, and give it
its own cookie prefix `acme-notes`.

```ts
const productName = "Acme Notes";
const supportEmail = "help@acme.test";

const appConfig = {
  identity: { productName, legalEntity: "Acme Inc.", supportEmail },
  runtime: {
    ports: { landing: 4000, web: 4001, admin: 4002, storybook: 4003, "landing-static": 4004 },
    authCookiePrefix: "acme-notes",
  },
  // brand and features unchanged
```

Then `./platform/tooling/node-ts.sh platform/tooling/app-config.ts shell` shows `APP_CONFIG_PORT_WEB=4001`,
`APP_CONFIG_ORIGIN_WEB=http://localhost:4001` and `APP_CONFIG_AUTH_COOKIE_PREFIX=acme-notes`.

**Done when** `git status --short` lists only `app.config.ts`, and lint, typecheck, `test` and
`test:unit` pass.
