# Foundation upgrades: executable downstream canary

Status: first implemented slice, not a package registry or an operations journey.
The executable contract is `scripts/foundation/upgrade.py`; its consumer is the
**real `apps/demo`**, with a Northstar Dispatch customization. Run:

```bash
bun install --frozen-lockfile
bun run test:foundation          # negative contract tests, no services
bun run test:foundation-canary   # old baseline -> discovery -> plan -> apply -> verify -> audit
```

The rehearsal needs Python 3 and installed Bun dependencies, but no GitHub,
Vercel, Convex, publishing credentials, live release service, or font download.
It never starts/stops a development environment. CI Shared runs it on every PR
and its summary fails if this check fails.

## Three separate planes

1. **Foundation release plane.** Maintainers publish an **immutable release**
   that states: the **affected layers**, its **security urgency**, required
   **migrations** and **codemods**, the **verification commands** an application
   must pass, and the **canary evidence** that a customized app (this demo) took
   it cleanly. A foundation release says *what changed, how urgent it is and how
   an application proves compatibility*. It does not change a business app or
   deploy anything.
2. **Business-app upgrade plane.** Each business app takes a release in an
   **explicit code-change upgrade PR** that preserves application-owned code.
   Its plan names the exact baseline, target, protected source fingerprint,
   actions and verification commands. Its tests prove both the foundation fix and
   its own branding/domain behavior. The app's normal review/merge controls decide
   whether that PR lands. An upstream green check alone is not proof that a
   customized downstream app is ready.
3. **Operations plane.** The operations tool **shows** available releases,
   lagging applications, security urgency and upgrade readiness, consuming and
   presenting the release metadata and upgrade evidence above. Only **after the
   business-app upgrade PR lands** does it deploy the resulting application
   commit through the normal **staging and production** paths, under their normal
   approvals.

The operations tool **must not** rewrite application source or perform hidden
migrations during deployment: every source change and migration reaches an app
through its reviewed upgrade PR. Likewise, neither `apply` nor `verify` commits,
pushes, opens/merges a PR, deploys, or changes any approval policy. Producing
evidence is not release or deployment permission.

In this first rail, the release catalogue carries the target, supported
baselines, file hashes, required action IDs (the migration/codemod hook),
`affectedLayers` and `securityUrgency`. `discover` reports the layers and urgency
of each available target, and every plan carries them. Verification commands are
fixed in the tool; canary evidence is the `foundation-canary-evidence` CI
artifact. This slice does not choose the operations UI,
execution model or orchestration, and adds no deployment/promotion commands or
hooks.

## Why this is the demo, not a toy replacement

Previously the demo contained its own 900+ line editable sidebar, a duplicate of
foundation width-clamping/snapping logic, blank dashboard panels, shared icons
copied on every build, and Google Fonts fetched during builds. It was not a
Convex/auth application. Introducing a backend merely to test a rate-limit
package would have obscured that boundary rather than tested it.

The demo now has app-owned branding, icon, dispatch data, a heavy-freight-first
priority rule, and an interactive ready-load dispatch board. Its vendored sidebar
also has an intentional 20rem mobile-width customization, distinct from the
upstream 18rem UI. The existing resize, responsive and navigation mechanics remain.
Only the pure
width policy was extracted, from **both** demo and shared design-system sidebars.
The source of future policy changes is
`packages/design-system/src/lib/sidebar-width.ts`.

The demo does **not** import that workspace file. It consumes a locked, read-only
source snapshot under `apps/demo/src/foundation/`. Local changes in the upstream
package cannot silently make a downstream test green. This is a small offline
**source-bundle rail**, not a claim to have published Tier 1 dependencies.

The first fixture transition, `sidebar-width-snapshot:1.0.0 -> 1.0.1`, fixes a real
stability defect: a non-finite resize width used to yield `NaNrem` or an extreme
clamp, and could poison persisted sidebar state. The target returns the existing
16rem default for non-finite values; normal bounds, rounding and snap points stay
unchanged. These are **rail-local fixture versions**, not starter git release tags,
not a CVE claim, and not evidence of a deployed schema migration.

## Ownership contract

`apps/demo/foundation.json` is a versioned JSON manifest. Ownership uses exact
files or trailing-slash directory prefixes; the most-specific match wins.
Unknown files fail planning instead of silently becoming replaceable.
Only `.DS_Store` (OS metadata) is skipped; any other unclassified file, including
a local `.env.local`, blocks planning until it is classified or removed.

| Ownership | Demo example | Upgrade behavior |
|---|---|---|
| `consumed` | `src/foundation/sidebar-width.ts` | Upstream-owned immutable snapshot. Exact baseline hash required; only declared target payload can replace it. |
| `vendored` | `src/components/ui/`, mobile hook, `src/lib/utils.ts` | Intentionally editable source. Never automatically replaced; protected byte-for-byte across this upgrade. |
| `application` | business rules, dashboard, CSS, `public/`, tests, configuration | Downstream-owned. Releases cannot write it. Changes after planning invalidate the plan. |
| `generated` | `.next/`, `.foundation/`, `foundation.lock.json` | Not editable source. Only the fixed generated allowlist is excluded from source fingerprints; a manifest cannot hide source by relabeling it. |

The writable payload allowlist is deliberately **one module** in schema version 1.
Changing a catalogue path cannot grant access to another path, even inside the
consumed directory. Directory traversal, symlink/hardlinked destinations, unknown schemas,
unknown actions, source drift and unsupported transitions fail closed.

Two valuable conflict seams were removed without reorganizing the repo:

- Shared width policy no longer requires replacing the editable visual sidebar.
- Demo assets no longer pass through `copy-shared-assets.sh`; that script must not
  overwrite downstream branding. The demo uses its own `public/northstar.svg`.

Other apps still use the shared icon pipeline. Repository-wide branding, schema
composition and locale namespacing are **not** solved by this slice.

## Manifest, release, plan, lock and evidence

All JSON contracts carry `schemaVersion: 1`. Unknown versions are rejected.

| File / object | Meaning |
|---|---|
| `foundation.json` | App-selected rail and exhaustive ownership map. No deployment configuration. |
| `foundation/releases/catalogue.json` | Trusted local release discovery: latest target, exact supported `from` baselines, required action IDs, affected layers (a fixed set of foundation packages), security urgency (`none`, `low`, `high`, `critical`), per-file SHA-256. |
| `foundation/releases/<version>/...` | Immutable source payloads. Old fixtures must not be regenerated to make new code pass. A test pins the current target to upstream source and the demo snapshot. |
| plan JSON | Deterministic ID, catalogue/tool/lock/source digests, baseline/target, before/after hashes, required actions and verification argv. Editing or replaying a stale plan is rejected. |
| `foundation.lock.json` | Installed release and content hashes. `baseline` means enrolled, **not verified**. `pending` means copied but not complete. `verified` references an applied plan and evidence digest. |
| `.foundation/evidence.json` + logs | Executed checks, exit codes, log/build-output hashes, plan/source identity and success/failure. `audit` validates retained evidence against the current tree and built artifact. |

SHA-256 binds reviewed bytes and catches drift; it is **not** a signature, proof of
publisher identity or protection against a malicious maintainer editing code and
evidence together. Obtain tooling and catalogues from a trusted, reviewed starter
revision. They are code; do not run arbitrary downloaded release bundles.

Commands are fixed by action ID in the tool, not executed from catalogue strings.
Schema 1 requires the `sidebar-finite-width` action, app business tests, typecheck
and a real Next.js build. There is no user-supplied “done” checkbox. Missing checks,
nonzero commands, timeouts, absent build output, changed source, incomplete copies
and missing action evidence cannot complete the upgrade. New/deployed migration
actions need an explicit future contract/tooling extension, not a free-text waiver.

`apply` writes a pending lock **before** touching consumed source. Interrupted
copies therefore cannot look successful. Commands use an exclusive per-app lock;
verification checks protected source again after running. Work in a clean branch
without other editors changing the app. This is not a filesystem transaction or
an adversarial sandbox.

## What the rehearsal actually proves

`rehearse.py` copies the current **whole demo** into
`.ci-local-artifacts/foundation-canary/apps/demo`. It copies trusted release
fixtures and reuses installed third-party dependencies, not workspace source.
The historical baseline is seeded only by this rehearsal helper; the public tool
has no force/downgrade/init bypass.

It then:

1. Runs the app-owned business tests and typecheck on the old baseline.
2. Requires the known non-finite-width regression test to be red on that baseline.
3. Discovers the available target and creates a deterministic machine-readable plan.
4. Applies the reviewed payload through the same CLI a business app uses.
5. Runs the foundation action (including rendered sidebar state/CSS/cookie checks),
   actual dashboard interaction/domain tests, TypeScript and `next build --webpack`.
6. Audits completion evidence and checks the prerendered dashboard includes the app
   brand and ready freight, excludes unready freight, and preserves the brand SVG.
7. Compares every protected app/vendored file hash before/after, not just known
   branding strings. The only source difference is the consumed foundation module.

Webpack makes this rehearsal independent of Turbopack's symlink-root assumptions
when reusing already-installed third-party dependencies in the isolated copy.
This is still Next's real production compiler, not a mocked build. Browser-level
visual/drag coverage and deployed auth/database behavior are outside this slice.

The full report, plan, baseline logs and completion evidence are retained as the
`foundation-canary-evidence` CI artifact. Local output is in
`.ci-local-artifacts/foundation-canary/report.json`. Fast failure tests live in
`scripts/foundation/test_foundation_upgrade.py`; they mock command exits only to test
failure-state handling. The separate end-to-end rehearsal never mocks verification.

## Joining this rail in a business app

The existing [merge-by-tag rail](../UPGRADING.md) still applies to the rest of the
starter. `.starter-version` records that repo baseline; this narrow rail lock is
**not** a replacement for it.

For a demo-derived business app:

1. Keep its app, tests, icon and vendored UI in app-owned paths. Copy the demo's
   `foundation.json`, locked snapshot and lock as an enrollment baseline, plus the
   reviewed `scripts/foundation/upgrade.py` and `foundation/releases/` catalogue.
   Keep `tsconfig.base.json` if the app config still extends it. Install dependencies
   through the app's normal reviewed Bun lockfile. The checked-in demo is already
   at `1.0.1`, so discovery correctly offers no newer target today.
2. Adapt the branding/domain tests to **your** business invariants. Preserve
   `test:foundation`, `test:business`, `typecheck` and `build` script contracts.
   This schema expects an App Router `/dashboard` build output. Apps with different
   layouts must extend and test the contract before enrolling; don't fake paths.
3. Review the ownership map against every source/config file. Newly added files
   need an explicit existing prefix or rule. Confirm consumed file hashes exactly
   match a supported release. Do not assert an arbitrary old version to force an
   upgrade. If the code is customized, extract that customization into the vendored
   shell first or remain on the documented manual merge rail.
4. Commit enrollment on a normal application PR. `baseline` enrollment asserts
   identity only; it never claims an upgrade was verified. Keep your own business
   app CI checks as well as the foundation checks.

For a future supported update (or the old baseline produced by the rehearsal),
work on a clean upgrade branch and substitute the app path/target:

```bash
python3 scripts/foundation/upgrade.py discover --app apps/demo
mkdir -p apps/demo/.foundation
python3 scripts/foundation/upgrade.py plan --app apps/demo --target 1.0.1 \
  > apps/demo/.foundation/plan.json
# Review the plan and release payload before applying.
python3 scripts/foundation/upgrade.py apply --app apps/demo --plan apps/demo/.foundation/plan.json
python3 scripts/foundation/upgrade.py verify --app apps/demo --plan apps/demo/.foundation/plan.json
python3 scripts/foundation/upgrade.py audit --app apps/demo
```

Do not run the example target on the already-current checked-in demo: exact
baseline-to-target transitions are required. Run the rehearsal to see that upgrade.
`--releases` accepts a reviewed local catalogue directory; no network discovery is
implemented. On success commit the snapshot and lock to the **business app's
upgrade PR**, attach/retain the plan and evidence through CI, and obtain its normal
review. The tool does not merge that PR. Deployment is a later operations-plane step.

If verification fails, the lock stays pending. Inspect `.foundation/*.log`, retain
the failure evidence, and retry `verify` only if protected source has not changed.
If app code needs a fix, or a copy was interrupted, restore the consumed snapshot
and lock from the clean pre-upgrade commit, make/review the app fix, then create a
new plan. Never hand-mark the lock verified. Replaying `apply` is intentionally
rejected. `audit` is current-tree validation; older evidence remains historical
information, not proof about later business edits or a future deployment.

**Ejection:** a modified consumed file is refused, not overwritten. Move customized
policy into an app-owned module, change its consumers, and explicitly stop using
this rail/lock in the app's enrollment PR. Continue the remaining starter's
merge-by-tag process and manually review subsequent sidebar changes. Automated
re-entry requires restoring a supported exact snapshot and behavior checks. There
is no claim that ejected source still receives automatic fixes.

## Remaining phases, tied to evidence

| Decision/work | Evidence now | Still needed |
|---|---|---|
| Consumed vs editable UI | One pure policy can upgrade while the local sidebar/brand/domain stay byte-identical | More modules, deletion/addition handling, multi-step migrations, signed/published release distribution |
| Branding ownership | Demo's asset copy conflict is gone; icon and brand survive build | Explicit brand configuration across web/admin/backend/locales; preserve their behavior first |
| Backend boundaries | No backend in this consumer; existing schemas/migrations untouched | Separate backend canary with real schema/migration evidence before Convex extraction |
| i18n | Existing resolver/merge rail retained | Namespacing and customized-locale rehearsal; no namespace migration shipped here |
| Registry/packages | Pinned offline source bundles prove a delivery contract | Publishing credentials, registry semantics, dependency provenance, Renovate delivery, broader LTS testing |
| Operations journey | Plan, lock and evidence have versioned machine-readable shapes | Operator UX/execution and integration with the separate operations work, only after contracts mature |

This is not completion of strategy Phases 1–3. It is executable evidence for one
boundary and one upgrade path, with explicit limitations instead of a promise
that every cloned business app is already automatically upgradeable.
