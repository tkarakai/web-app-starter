# Starter package upgrades

The demo is a standalone UI demonstration with a responsive, resizable sidebar,
custom navigation, and an interactive Northstar Dispatch board. We also use a
copy of it to test starter upgrades. The test is not the app's purpose.

## What works today

One package has a supported ownership boundary: `@repo/starter-sidebar-policy`.
Its TypeScript source is in `packages/starter-sidebar-policy`. The demo consumes
an independently versioned, built package through its package exports, not through
an import of current workspace source.

The local package releases `1.0.0` and `1.0.1` are immutable test fixtures in
`apps/demo/qa/fixtures/starter-releases/`. These are package artifacts containing
`package.json`, JavaScript and declarations. They are not published registry
packages or starter git tags. The demo's installed package is kept separately in
`apps/demo/starter-packages/sidebar-policy/`, because that is a real dependency
of the demonstration app.

```bash
bun install --frozen-lockfile
bun run check:starter-ownership
bun run test:starter-upgrade
bun run test:starter-rehearsal
```

The scripts run on Node 24 and are written in TypeScript. Bun remains the package
manager and launches the existing app test/build scripts.

## Ownership: who may change each file?

Ownership and release/deployment responsibilities answer different questions.
The [three responsibilities in UPGRADING.md](../UPGRADING.md#three-separate-responsibilities)
explain who releases, upgrades and deploys. This table explains who may edit code.

| Category | Purpose and owner | Example | Upgrade rule |
|---|---|---|---|
| Consumed starter package | Maintained and versioned by starter authors; applications use its exported API | `starter-packages/sidebar-policy/` in the demo | Only the declared package payload may replace an exact known baseline. Local edits stop the upgrade. |
| Application-owned | Maintained by the application team; includes copied UI that has no supported starter update contract | Demo `src/`, `public/`, tests and configuration | Never overwritten by the package upgrader. Every byte is checked before and after verification. |
| Generated | Produced by a named tool, not edited by hand | Next.js `.next/`; TypeScript build info; upgrade lock and evidence | Only a fixed list is excluded from source checks. Labeling arbitrary source as generated is rejected. |
| Vendored starter code (not supported yet) | An editable copy with an explicit upstream origin and a supported comparison/update contract | Candidates: selected design-system components and design patterns | There is no registry/copy contract today. No demo path is labeled vendored, and the tool rejects that label. |

The demo's existing editable UI has copied/shadcn origins. That alone does **not**
make it an example of supported starter vendoring. It is application-owned here.
The backend schema still mixes starter tables with example/business tables;
i18n messages mix shared and application text; design-system and design-patterns
contain potential editable components. `scripts/starter-upgrade/ownership.json`
records these mixed legacy areas. This change does not certify them as isolated,
published, or safely replaceable packages. Other workspace packages also remain
outside this single-package upgrade contract.

### What may cross a boundary?

- Application code may import the consumed package's public exports. The package
  may not import application code, editable UI, or generated application output.
- Application configuration selects the local package location. The upgrader
  validates that selection; it does not rewrite `package.json`.
- The TypeScript compiler produces a release artifact from starter-owned source.
  A release adds a new version; it must not silently change an old fixture.
- Build tools may read application and consumed code to generate build output.
  A successful build does not transfer ownership of either input.
- A package upgrade may replace only the package files named in the tool's fixed
  write list. It cannot add an application path to that list through metadata.

### Copying a package into editable code

There is **no supported package-to-vendored command today**. Changing the manifest
label is not a workaround: the tool refuses it. Do not edit the managed package
or put a second managed copy under an application-owned label and claim that it
still receives this package's verified upgrades.

Before supporting such a transition, a reviewed copy contract must specify:

1. The permitted package/export and complete dependency/license contents to copy.
2. A new, non-overlapping editable destination and its application owner.
3. The exact source package version and content hash, retained as copy provenance.
4. Explicit import changes and removal of managed consumption for the copied
   component. A path must never be both package-managed and editable/vendored.
5. How the copied component is compared with later releases, and which security
   fixes now need manual review. Its old package version is provenance, not a
   claim that the customized copy still equals that release.
6. Upgrade-PR tests, recorded copy evidence and new ownership metadata. Existing
   package-upgrade evidence must be invalidated and cannot certify the copy.

Until that contract exists, applications needing this policy changed should ask
for a package API change or maintain a separately reviewed application fork
outside this automated upgrade contract. Neither choice can claim automatic
package-update coverage for the copied code.

## What the deterministic checks prove

`check:starter-ownership` compiles the actual author package with no external
imports/types, compares its output with the current immutable artifact, checks
its version and public export map, and executes package resolution from the demo.
It rejects private subpath imports and workspace-source substitution. It checks
representative application/consumed/generated paths and the exhaustive demo
manifest. Fixture hashes are pinned in the ownership inventory.

`test:starter-upgrade` exercises rejected writes, local edits, unsupported
versions, missing actions, modified plans, incomplete copies, stale installed
packages, invalid evidence and overlapping ownership. It also deliberately adds
an application import to a package copy and checks that author validation fails.

These checks prove this package and this consumer boundary. They do **not** prove
that every existing workspace package follows the same rules. Broader schema,
locale, editable-UI and registry separation is follow-up work.

## The release, plan, lock and evidence

| File | Meaning |
|---|---|
| `apps/demo/starter-upgrade.json` | Exhaustive ownership map and chosen package. Exact paths or directory prefixes; the most specific match wins. |
| `apps/demo/qa/fixtures/starter-releases/catalogue.json` | Known releases, supported starting versions, file hashes, affected layers, security urgency and required action IDs. |
| `apps/demo/starter-upgrade.lock.json` | Installed package identity. `baseline` means recorded, not tested; `pending` means applied but not verified; `verified` references retained evidence. |
| Plan JSON | Exact before/after hashes, source/catalogue/tool/lock identity, required actions and verification commands. Review before applying. |
| `apps/demo/.starter-upgrade/evidence.json` and logs | Command results, output hashes, source identity and built dashboard hash. `audit` checks these against the current files. |

Only `.DS_Store` is ignored as OS metadata. Unknown files such as `.env.local`
need explicit application ownership before planning. A manifest cannot hide
source by marking it generated. Paths with symlinks are refused. Application
hardlinks are refused; consumed files that Bun hardlinks into its dependency
cache are replaced atomically, so old cache aliases are not modified.

The catalogue is reviewed local code, not an untrusted command source. Actions
and commands are fixed in the TypeScript tool. The current release has one
required action, `sidebar-finite-width`, and no database migration or codemod.
Unknown actions stop execution rather than being silently skipped. Hashes detect
changes; they are not signatures or a defense against someone replacing the
trusted tool, metadata and evidence together.

## The real demo rehearsal

`bun run test:starter-rehearsal` copies the app to
`.ci-local-artifacts/starter-upgrade/apps/demo`. It reuses installed third-party
dependencies, but installs the starter package from the copied release artifact,
not authoring source. The local package is linked into the copied app's
`node_modules`, so normal package exports are used by tests, TypeScript and Next.

1. Install historical package `1.0.0` in the copy. Business tests and types pass.
2. Run the sidebar regression tests. Two fail: non-finite policy input does not
   return the default, and the rendered sidebar retains an invalid width.
3. Discover `1.0.1`, produce a deterministic plan, and apply that plan.
4. Run the required regression action, dispatch tests, typecheck and production
   build. The new policy returns the existing 16rem default for NaN/infinities.
5. Audit the retained logs and built dashboard. Compare every application-owned
   byte with the pre-upgrade copy, including editable sidebar code and branding.

The report and logs are retained under `.ci-local-artifacts/starter-upgrade/` and
uploaded as `starter-upgrade-evidence` in CI. A new successful build is required;
a zero exit code with a stale build artifact does not count.

## Applying an upgrade in an application PR

This CLI supports this package and this demo-shaped consumer, not arbitrary
starter merges. Existing apps should keep using [merge-by-tag](../UPGRADING.md).
Adopting this package requires a reviewed ownership manifest, its dependency
selection, required test scripts, and a known baseline; copying a lock alone is
not enrollment. Keep app-specific checks in addition to the starter checks.

On a fresh application branch with the historical baseline installed:

```bash
bun run starter-upgrade discover --app apps/demo
mkdir -p apps/demo/.starter-upgrade
bun run starter-upgrade plan --app apps/demo --target 1.0.1 \
  > apps/demo/.starter-upgrade/plan.json
# Review the plan before proceeding.
bun run starter-upgrade apply --app apps/demo --plan apps/demo/.starter-upgrade/plan.json
# Refresh Bun's local file dependency cache after replacing a package artifact.
bun install --force --frozen-lockfile
bun run starter-upgrade verify --app apps/demo --plan apps/demo/.starter-upgrade/plan.json
bun run starter-upgrade audit --app apps/demo
```

The checked-in demo is already at `1.0.1`; use the rehearsal to run this transition
without downgrading your working app. The historical installer exists only in the
test helper, not in the upgrade CLI.

`apply` records `pending` before copying anything. On interruption, restore the
package and lock from git, or verify only if the complete target is installed.
If a process was killed, inspect `.starter-upgrade/upgrade.guard` and confirm no
command remains active before removing that guard directory. Do not edit a plan
to bypass a refusal. Source changes after planning require a new plan from a
valid baseline. Failed verification records an error and never claims success.

Commit the package and baseline/ownership changes in the application PR, retain
verification evidence with that PR, and run the application's normal CI. The
upgrader neither merges nor deploys. Operations may present releases, urgency and
verified application readiness, then deploy the approved application commit; it
must not rewrite source or perform hidden migrations during deployment.
