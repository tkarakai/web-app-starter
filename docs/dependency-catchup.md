# Dependency catch-up (2026-09-24)

Snapshot of [the Renovate dashboard](https://github.com/tkarakai/web-app-starter/issues/94).
This is a compatible remainder, not a claim that every dependency is current. Keep the
dashboard open. No original bot branch was overwritten, closed, merged, or re-armed.
The ten-day release age, auth caps, and manual major/lock-maintenance policies are unchanged.

## Existing chore pull requests

| Source | Disposition |
| --- | --- |
| https://github.com/tkarakai/web-app-starter/pull/100 | Superseded by the merged Convex/dev catch-up below; source branch preserved. |
| https://github.com/tkarakai/web-app-starter/pull/107 | Superseded by the merged Convex/dev catch-up below; source branch preserved. |
| https://github.com/tkarakai/web-app-starter/pull/105 | Bun 1.4.2 applied additively here, including the CI composite default and exact-version act cache selection. Owner-disabled automerge unchanged. |
| https://github.com/tkarakai/web-app-starter/pull/108 | React and React DOM 19.3.0 applied together in root overrides and the web manifest. Owner-disabled automerge unchanged. |
| https://github.com/tkarakai/web-app-starter/pull/120 | Verified merged at `86901e53f796d3c0b7b40871ae7ddd6b883e62f0`; integrated by an ordinary merge, preserving both histories. |

The live open list contained only the four original chore PRs after that merge.

## Dashboard dispositions

“Updated” below means implemented locally; final-head no-mistakes and forge CI are still required.

| Dashboard item | Disposition |
| --- | --- |
| Next 16.3.5 | Updated root override and web pin; 16.3.6 is too young. |
| lucide-react 0.577.0 | Superseded by the eligible 1.46.0 update across all direct consumers. |
| lucide-react 1.x | Updated to 1.46.0; typechecks and builds require no icon import changes. |
| tailwind-merge 3.7.0 | Updated design-system and demo. |
| @testing-library/jest-dom 7 | Updated to 7.0.1; existing DOM 10 satisfies its `>=10 <11` peer. Component suites pass. |
| Resend 6 | Updated to eligible 6.28.0; `@react-email/render` is optional and existing callers send HTML/text. Types and backend tests pass. |
| actions/checkout 7 | Updated to SHA for 7.0.1. Existing credential opt-outs preserved; no unsafe fork opt-in added. |
| actions/cache 6 | Updated to SHA for 6.1.0; cache paths and act bypass unchanged. |
| actions/setup-node 7 | Updated to SHA for 7.0.0; Node 24 unchanged, automatic package-manager cache explicitly disabled in favor of the existing Bun cache. |
| actions/github-script 9 | Updated to SHA for 9.0.0. Scripts use injected clients or a local CommonJS helper, not the removed `require('@actions/github')` interface. |
| actions/attest-build-provenance 4 | Updated to SHA for 4.2.2. Its wrapper still accepts existing subject paths; permissions, conditions, and artifact identity unchanged. |
| actions/dependency-review-action 5 | Updated to SHA for 5.0.0, including pinning the previously floating tag; security settings unchanged. |
| dorny/paths-filter 4 | Updated to SHA for 4.0.3; Node 24 migration, existing filters/quantifiers unchanged. |
| upload-artifact 7 / download-artifact 8 | Updated together to SHAs for 7.0.1 / 8.0.1. Keep default ZIP transport and existing names/paths; no direct-upload opt-in. Download now fails closed on digest mismatch. |
| github/codeql-action 4 | Updated all three steps to eligible 4.38.0 SHA; languages, queries, permissions, and triggers unchanged. |
| CodeQL digest 3ea0661 | Still younger than ten days (commit September 18). Not adopted; old-major proposal superseded by eligible v4.38.0, not by bypassing cooldown. |
| TruffleHog digest daea5a6 | Held for cooldown: commit September 24. Existing pinned scanner unchanged. |
| Renovate action 46.3.3 | Held for cooldown: published September 21. Keep already-merged 46.3.1. |
| @types/node 26 | Held: CI/tool runtime is Node 24. Do not widen the declared API surface further without a runtime/types alignment decision; existing 25.x catch-up preserved. |
| @vitejs/plugin-react 6 | Held: 6.1.1 requires Vite 8 and Node `^20.19.0 || >=22.12.0`, excluding part of the root `>=22.6` contract. Needs an explicit runtime-floor migration and paired Vite/component-suite validation. |
| size-limit / @size-limit/file 13 | Held: eligible size-limit 13.1.1 requires Node `^22.18.0 || ^24.0.0 || >=26.0.0`, excluding supported 22.6 and odd majors. Needs a runtime-contract decision and paired file-plugin/bundle-limit validation. |
| ESLint 10 | Held: latest eslint-plugin-react 7.37.5 only supports ESLint through `^9.7`. Needs compatible React lint tooling, not ignored peers or removed rules. |
| TypeScript 7 | Held: latest @typescript-eslint/parser 8.70.1 requires TypeScript `<6.1.0`. Needs parser compatibility before compiler migration. |
| TanStack table 9 | Trial 9.2.4 failed admin typechecking: removed `useReactTable`, `getCoreRowModel`, and `getSortedRowModel`; `Table` and `ColumnDef` now require additional generics. Trial reverted. Needs migration of users, waitlist, admins, audit tables and shared column/filter/selection helpers, plus behavioral coverage of sorting/paging/selection. |
| zxcvbn-ts 4 | Trial core 4.2.0 with language-common 4.1.3 and language-en 4.1.1 failed both types and execution: `zxcvbn` and `zxcvbnOptions` no longer exported (factory API instead). Trial reverted. Needs a factory migration and password-score/translation parity assessment before changing account-creation/reset enforcement. No password policy weakened. |
| Lock-file maintenance | Not performed as a broad transitive refresh. Only required direct-update resolutions regenerated with the ten-day age gate. The separate manual weekly maintenance item remains outstanding. |

The auth stack is not an uncapped update candidate: latest adapter 0.12.5 still requires
`better-auth >=1.6.11 <1.7.0`. Existing whole-stack cap remains necessary.

## Verification and remaining gates

- Used Bun 1.4.2 locally and `bun install --minimum-release-age=864000`; frozen install passes.
- Registry publication audit of all **21** newly resolved versions relative to the merged
  Convex/dev main: every version is at least ten days old; none has an unknown date.
- `bun run ci:quick` passed: types, lint, development-script and unit suites, component
  coverage, backend (180 tests), starter ownership/upgrade/rehearsal, builds and bundle limits.
- Forced all-workspace builds, component tests and types also pass (21 tasks, no cache),
  including demo and landing-static. A first direct invocation lacked build environment
  variables; the successful rerun used the same non-secret placeholders as local CI.
- New executable act cache tests cover exact-version reuse, missing/stale cache installation,
  download failure and a wrong-version installer result. Development-script tests/types/lint pass.
- `actionlint -shellcheck=''` passes. Full actionlint reports existing shell-style warnings
  in unchanged workflow scripts; the new Bun setup helper passes shellcheck.
- Actions runtime upgrades require runner 2.327.1+ (checkout container authentication 2.329.0+).
  Hosted runners are used; act must use an image supporting Node 24. Refresh offline action caches.
- No production/CD workflow was dispatched. Final no-mistakes review, live behavior/E2E,
  security workflows and final-head forge CI remain publication gates, not claimed local evidence.
