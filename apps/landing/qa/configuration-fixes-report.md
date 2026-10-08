# Landing configuration fixes: #320, #321, #324

The retained landing component tests, dynamic-feature E2E scenarios, and production export smoke now follow `appConfig.features.waitlist` and `appConfig.features.announcements`. Disabled features receive explicit absence assertions while the HTTP mocks offer enabling responses; no feature scenario is skipped. The application components already enforced the switches, so no product source changes were needed.

## Changed files

- `apps/landing/qa/tests/hero-cta.test.tsx`: exercises the configured switch and both explicit waitlist variants, preserving the complete positive form case and asserting no form or registration CTA when disabled.
- `apps/landing/qa/e2e/dynamic-features.spec.ts`: runs waitlist submission and announcement interactions when enabled; when disabled checks absent controls, CTAs, details, banner spacing, and announcement polling. The disabled waitlist case still receives backend `publicWaitlist`; the disabled announcement case offers an active announcement response.
- `platform/tooling/landing-export/landing.spec.ts`: separates backend availability from feature availability and checks configured disabled features as closed. Also verifies announcement presence/absence against the real exported HTML, JS, and CSS.
- `apps/landing/qa/helpers/configuration-acceptance.ts`: creates and really adopts an isolated temporary repository, verifies adoption retained the test files unchanged, renames the product, selects only English, and tests all four feature combinations. Browser runs use the normal Next Turbopack path and copied pinned dependencies; component-only runs share external pinned dependencies while retaining fixture-local workspace packages. Only disposable fixture repositories are committed; no checkout commit, install, or remote operation occurs.
- `platform/tooling/tests/landing-configuration.test.ts`: adds the adoption/component/discovery matrix to `test:dev-scripts`; runs four component suites and verifies enabled/disabled E2E scenario discovery.
- This report.

The coordinator confirmed this is the product repository, with no `.platform-base.json`. The `platform-patch` skill says reference apps never carry patch records; no patch marker or registry edit was needed. `platform/tooling/test-landing-export.sh` is unchanged.

## Commands and results

| Exact command | Result |
| --- | --- |
| `bun run --cwd apps/landing test:unit` | Passed: 4 files, 13 tests. |
| `bun run --cwd apps/landing test` | Passed: 2 files, 5 tests. |
| `bun run --cwd apps/landing lint` | Passed; repeated after the final helper changes. |
| `bun run --cwd apps/landing typecheck` | Passed. |
| `./platform/tooling/node-ts.sh --test platform/tooling/tests/landing-configuration.test.ts` | Passed: 1 adoption acceptance test, including 4 × 13 component tests and E2E discovery for each configuration. |
| `./platform/tooling/node-ts.sh apps/landing/qa/helpers/configuration-acceptance.ts --all > /tmp/landing-configuration-acceptance.log 2>&1` | Passed: all four configured feature combinations; 52 component executions, 20 dynamic-feature E2E tests, and 8 export smoke tests. |
| `./node_modules/.bin/eslint platform/tooling/landing-export/landing.spec.ts platform/tooling/tests/landing-configuration.test.ts --max-warnings 0` | Passed. |
| `bun run typecheck:dev-scripts` | Passed. |
| `./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --types node --skipLibCheck apps/landing/qa/helpers/configuration-acceptance.ts` | Passed. |
| `bun run check:zone` | Passed; product repository mode. |
| `git diff --check` | Passed. |
| `git diff -- app.config.ts` | Empty; root configuration preserved. |

The all-stage runner executes these commands inside the adopted temporary copy for each feature combination:

```sh
bun run test:unit
./node_modules/.bin/playwright test --config=configuration.playwright.ts
# Twice, with NEXT_PUBLIC_CONVEX_SITE_URL empty and configured respectively:
bun run build
bash platform/tooling/test-landing-export.sh
```

The generated E2E config selects `dynamic-features.spec.ts`, Chromium, one worker, zero retries, and a fresh loopback port. Builds use `NEXT_PUBLIC_WEB_APP_URL=https://web.example.test`; the configured backend is `https://backend.example.test` and all feature HTTP responses are intercepted. Export smoke receives `EXPORT_EXPECT_CONFIGURED=false` or `true` matching the build.

| Waitlist | Announcements | Component suite | Dynamic E2E | Missing/configured exports |
| --- | --- | --- | --- | --- |
| enabled | enabled | 13/13 | 5/5 | 1/1 + 1/1 |
| disabled | enabled | 13/13 | 5/5 | 1/1 + 1/1 |
| enabled | disabled | 13/13 | 5/5 | 1/1 + 1/1 |
| disabled | disabled | 13/13 | 5/5 | 1/1 + 1/1 |

## Verification limits and resolved experiments

No current blockers remain. Full repository CI and the unrelated landing locale/metadata E2E suites were not run by this worker; the configuration runtime matrix specifically targets the affected dynamic-feature suite and production artifact smoke.

An initial fixture experiment used webpack with shared external dependencies: its 5 enabled E2E tests passed, but its build failed with Next's unsupported static-export Server Actions message. The final fixture copies the pinned dependencies and uses the app's normal Turbopack build; all 8 real builds and export smokes passed. The initial explicit-files TypeScript command required this installed TypeScript version's `--ignoreConfig`; the corrected command above passed.

Existing Vitest configuration emits native-loader and removed-`poolOptions` warnings; those are unrelated and do not fail these checks. The pre-existing `bun.lock` change, other workers' edits, shared root config, and web files were preserved. No shared formatter, root commit, push, or GitHub write was performed.
