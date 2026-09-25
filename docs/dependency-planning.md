# Offline dependency planning prototype

This tool compares **declarations supplied by a caller** from old starter A,
downstream app B and target starter C. It helps review dependency intent before
any changes. It is independent of the sidebar package upgrader and is not a
whole-repository upgrade or compatibility check.

```sh
./scripts/node-ts.sh scripts/starter-upgrade/dependency-plan.ts \
  --base /snapshots/old-starter.json \
  --downstream /snapshots/business-app.json \
  --target /snapshots/target-starter.json
```

Only Node built-ins are used. Node 22.6+ and the existing `scripts/node-ts.sh`
wrapper suffice; the planner needs no `node_modules`, Bun install, TypeScript
compiler or semver library. The wrapper starts Node; the TypeScript CLI itself
does not spawn processes. It reads only the explicitly supplied JSON files and
writes its report to stdout. It does not discover workspaces, read Git, fetch
registries, execute lifecycle scripts, install, rewrite manifests or locks,
create a guard/cache/report file, apply changes, or advance a baseline.

## Snapshot contract (schema 1)

Prepare each snapshot explicitly from the chosen source. Enrollment, source
selection, manifest completeness and authentication are the caller's
responsibility. There is no automatic collector in this prototype.

```json
{
  "schemaVersion": 1,
  "claimedStarterIdentity": {
    "origin": "example/starter",
    "release": "example-release",
    "digest": "caller-asserted-value"
  },
  "manifests": {
    "package.json": {
      "name": "business-app",
      "packageManager": "bun@1.4.2",
      "engines": { "node": "24.x" },
      "workspaces": ["apps/*"],
      "overrides": { "react": "19.3.0" }
    },
    "apps/web/package.json": {
      "name": "web",
      "dependencies": { "react": "19.3.0", "@repo/auth": "workspace:*" }
    }
  }
}
```

- `schemaVersion` must be `1`. Unknown top-level fields are rejected, including
  proposed advisory/lockfile schemas this implementation does not support.
- `claimedStarterIdentity` is optional and must be an object if supplied. Its
  contents are retained and hashed but **never verified**. A mismatched origin,
  digest, release or partially adopted component vector does not establish a
  baseline; the report always labels identity `asserted-not-verified`.
- `manifests` is an object with an explicit root `package.json`. Other keys are
  normalized, case-sensitive relative POSIX paths ending in `package.json`.
  Absolute, drive, backslash, empty, `.` and `..` components are rejected.
  Paths identify supplied data; they are never opened or glob-expanded.
- Manifest values must be objects. `dependencies`, `devDependencies`,
  `optionalDependencies` and `peerDependencies`, when present, must be objects
  with nonempty string names and nonempty string specs. Missing sections mean
  no declarations; malformed sections do not silently become empty maps.
- Manifest names and `packageManager` must be nonempty strings when present;
  `engines` is a string map. Override/resolution/catalog maps, `devEngines` and
  `peerDependenciesMeta` must be objects. Peer metadata entries must be objects
  and their `optional` field must be boolean if supplied. Workspaces may be a
  string array or an opaque policy object. These shape checks do not validate
  package-manager semantics. Nested override selectors remain opaque.
- Duplicate JSON object keys (including equivalent escaped spellings) are
  rejected before a value can be silently discarded. Duplicate workspace
  **names** at different paths are retained with review diagnostics.
- Other manifest fields are retained in input hashing but are not compared.
  For example, scripts are never executed or assessed. Do not interpret this
  dependency report as a source, configuration, migration or business audit.

## Output and exits

`--help` is the only flag besides `--base`, `--downstream` and `--target`.
Unknown flags, repeated flags, missing values and unreadable/malformed inputs
produce one JSON error on stderr, no report on stdout, and exit **1**.

A complete three-way advisory report exits **0**, even when it contains conflicts
or manual review items. Exit 0 means the comparison ran, **not** that an upgrade
is safe. Without `--base`, the CLI emits an `inventory-only` B/C report and exits
**2**. This distinguishes missing enrollment evidence for automated callers.
Help exits 0. There is no apply, output-file or force option.

The report always contains:

```json
{
  "schemaVersion": 1,
  "status": "advisory",
  "compatibility": "not-assessed",
  "security": "not-assessed",
  "baselineAdvanced": false
}
```

`inputHashes` contains SHA-256 hashes of canonical parsed JSON for each supplied
bundle (base is null when absent). All fields contribute, including claimed
identity, policies and unexamined manifest fields. Object keys sort by code unit;
array order and raw strings are preserved. Input formatting, object key order,
file location and observation time do not affect hashes or output bytes. These
are content fingerprints, **not signatures or trusted provenance**. The report
`id` hashes `{reportSchemaVersion: 1, inputHashes}`. Consumers must include the
schema version when interpreting output; changed report semantics require a
schema change. Numbers use JSON/JavaScript parsing semantics; use strings for
identity digests, versions and large identifiers.

Each workspace retains its path, presence and names across A/B/C, dependencies
by section, and policy review items. `A`, `B`, `C` and `current` retain raw
spec strings, or null for absence. `current` is always B, including a downstream
deletion; it is not a generated merged manifest. In inventory mode, A null means
unknown base, not a known deletion. Workspace presence distinguishes a missing
manifest from a missing declaration.

| Structural relationship | Classification | Advisory disposition |
| --- | --- | --- |
| A = B = C | `unchanged` | Keep downstream |
| B = A, C differs | `upstream-only` | Candidate upstream; review required |
| C = A, B differs | `downstream-only` | Keep downstream |
| B = C, both differ from A | `converged` | Keep downstream; no migration-completion claim |
| Both changed differently | `divergent` | Manual review; current remains B |
| No base | `inventory-equal` / `inventory-different` | Retain B; do not infer which side changed |

Absence participates in equality: this covers additions, removals, add/add and
edit/delete conflicts and both deleting. Candidate removals explicitly require
usage review. Section moves, duplicate declarations across sections, missing
workspace mappings, renamed or duplicate workspace names require manual review.
There is no rename inference, consolidation or global max-version selection.

Only strict stable `MAJOR.MINOR.PATCH` specs receive numeric ordering annotations
in `exactVersionDirection`. Each pair must contain two such versions; absent or
unsupported values are labelled explicitly. Leading zeros, `v` prefixes,
prereleases, build suffixes, ranges, aliases, protocols, tags and malformed
version-like strings are never coerced. Numeric segments use arbitrary precision.
A target lower than B receives a review reason; **B is never downgraded**. Even
an exact-version increase says nothing about compatibility or security.

Every peer declaration carries `peer-constraints-not-assessed`. Root and local
`overrides`, `resolutions`, `engines`, `devEngines`, `packageManager`, `workspaces`,
`peerDependenciesMeta`, `catalog`, `catalogs`, `os`, `cpu` and `libc` are separate
manual review items, including unchanged policies. Constraints stay at their
source paths. Optional peers are shown, not installed or solved. Overlapping
ranges, overridden effective versions and mixed workspace majors are not solved.

No advisory or resolution metadata is accepted, no security status is inferred
from version order, and no baseline identity is authenticated. Missing candidate
peer metadata, known or unknown vulnerabilities, stale advisories, migration
completion and downstream tests all require external evidence. `limitations`
makes these gaps explicit in every report. A kept or converged declaration does
not mean the app is compatible, migrated, secure or fully inventoried.

## Validation

The existing `test:starter-upgrade` glob and shared CI job pick up the behavioral
CLI tests; no new workflow is needed.

```sh
./scripts/node-ts.sh --test scripts/starter-upgrade/dependency-plan.test.ts
bun run typecheck:starter-upgrade
bun run lint:starter-upgrade
bun run check:starter-ownership
bun run test:starter-upgrade
bun run test:starter-rehearsal
```

Tests execute the CLI from a temporary standalone directory without dependencies,
cover structural classifications and refusals, compare output determinism, and
fence process/network/write calls with positive controls plus filesystem snapshots.
Real checked-in manifests exercise root policies, web pins, demo ranges/local
packages, and shared peers. Synthetic React 20 examples test preservation only;
this change updates no project dependencies.
