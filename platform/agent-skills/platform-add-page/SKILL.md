---
name: platform-add-page
description: Use to add a page to the web app - a protected dashboard page with its nav entry, localized strings and tests - or a public page. Covers routing, the auth guard, the app shell and navigation.
---

# Add a page to the web app

Paths are relative to `apps/web/`. Background: `platform/docs/architecture.md` (route protection)
and `platform/docs/i18n-architecture.md` (routing, translations).

## Decide where it goes

| Page | Folder | Protection |
|---|---|---|
| Signed-in users only (the usual case) | `src/app/[locale]/(dashboard)/dashboard/<name>/` | Proxy prefix `/dashboard`, the `(dashboard)` layout's server check, and the client `AuthGuard`: all automatic |
| Sign-in style pages for signed-out users | `src/app/[locale]/(auth)/<name>/` | `GuestGuard` redirects signed-in users away |
| Public | `src/app/[locale]/<name>/` | None |

Every page lives under `[locale]`, so its URL is `/<locale>/...`. The `(dashboard)` layout
already rejects unauthenticated, banned and admin users and enforces the MFA policy; don't
repeat those checks in the page. A protected page outside `/dashboard` would also need its
prefix in `PROTECTED_PREFIXES` in `src/proxy.ts`; prefer staying under `/dashboard`.

## Steps

1. **Strings.** Add a namespace for the page with the `platform-add-strings` skill: at least a
   title and a description, plus every label the page shows. No literal UI text in components.
2. **Content component.** `src/components/<name>/<name>-content.tsx`, a Client Component
   (`"use client"`) that renders the page body from `useTranslations("<namespace>")`. Keep data
   loading (`useQuery(api.<module>.<fn>)`) here too, and handle `undefined` (loading) and `null`
   (signed out) results.
3. **Shell.** Dashboard pages render inside the app shell: sidebar, header with breadcrumb, and
   the announcement banner. Copy the shell from `src/components/settings/account-client.tsx`
   into `src/components/<name>/<name>-client.tsx` and replace its body with your content
   component. Breadcrumb: `td("projects")` linking to `/dashboard`, then your page title.
4. **Route.** `src/app/[locale]/(dashboard)/dashboard/<name>/page.tsx` is a Server Component that
   renders the shell component:

   ```tsx
   import { HelpClient } from "@/components/help/help-client";

   export default function HelpPage() {
     return <HelpClient />;
   }
   ```

5. **Nav entry.** The web app's navigation is `src/components/projects/app-sidebar.tsx`. Add a
   `DropdownMenuItem` to the user menu next to "Account", with a `lucide-react` icon and a
   translated label, navigating with `router.push("/dashboard/<name>")` (the proxy keeps the
   user's locale). A page that belongs with projects goes in the sidebar content instead.
6. **Tests.**
   - A Vitest component test for the content component in `qa/tests/<name>-content.test.tsx`,
     rendered inside `NextIntlClientProvider` with the real catalogue (see `qa/tests/localized-controls.test.tsx`).
     Mock Convex hooks with `vi.mock("convex/react", ...)` if the component queries data.
   - A Playwright spec in `qa/e2e/<name>.spec.ts`: an unauthenticated visit to
     `/en/dashboard/<name>` redirects to `/en/sign-in`, and a signed-in user (`signIn` from
     `qa/e2e/helpers/auth.ts` with a `createDisposableUser()` from `qa/e2e/helpers/fixtures.ts`)
     sees the page heading.
7. **Check.**

   ```bash
   bun run lint && bun run typecheck
   bun run --cwd apps/web test          # catalogue and unit tests
   bun run --cwd apps/web test:unit     # component tests
   bun run --cwd apps/web test:e2e -- qa/e2e/<name>.spec.ts   # needs the dev stack
   ```

## Worked example

**Task:** add a Help page at `/dashboard/help` in the web app. It shows a heading, a short
description, the number of guides, and a "Contact support" link to `mailto:support@example.com`.
Signed-in users reach it from the user menu, under "Account".

1. Strings: the `help` namespace from the `platform-add-strings` worked example, plus
   `"menuLabel": "Help"` in all 15 locales.
2. `src/components/help/help-content.tsx`:

   ```tsx
   "use client";

   import { useTranslations } from "next-intl";

   const GUIDE_COUNT = 3;

   export function HelpContent() {
     const t = useTranslations("help");
     return (
       <div className="space-y-2">
         <h1 className="text-xl font-semibold">{t("title")}</h1>
         <p className="text-sm text-muted-foreground">{t("description")}</p>
         <p className="text-sm">{t("guideCount", { count: GUIDE_COUNT })}</p>
         <a className="text-sm underline" href="mailto:support@example.com">{t("contactSupport")}</a>
       </div>
     );
   }
   ```

3. `src/components/help/help-client.tsx`: the `AccountClient` shell with the tabs replaced by
   `<HelpContent />` and the breadcrumb page set to `t("title")`.
4. `src/app/[locale]/(dashboard)/dashboard/help/page.tsx` as in step 4.
5. In `app-sidebar.tsx`, after the Account item:

   ```tsx
   <DropdownMenuItem onSelect={() => router.push("/dashboard/help")}>
     <LifeBuoy className="me-2 h-4 w-4" />
     {th("menuLabel")}
   </DropdownMenuItem>
   ```

   with `const th = useTranslations("help");` and `LifeBuoy` added to the `lucide-react` import.
6. `qa/tests/help-content.test.tsx` renders `HelpContent` with `en` and checks the heading, the
   pluralized guide count ("3 guides") and the link's `href`; `qa/e2e/help.spec.ts` checks the
   redirect and the signed-in heading.

**Done when** lint, typecheck, `test` and `test:unit` pass, and the E2E spec passes against the
dev stack (`bun run dev:web`).
