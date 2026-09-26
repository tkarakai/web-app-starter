# An upgradeable foundation, with room for a different product

Working design for review · 25 September 2026

This is a fresh response to the 22-part downstream upgrade brief. Earlier upgradeability roadmaps do not constrain the recommendation. Existing code and tests are evidence, not commitments to a future architecture. Statements marked **proposed** describe work that is not shipped. Source inspection starts at `f828ae8de8c15bcf8e637a758b11bed6d30db80f`; implementation PRs and their validation are tracked separately in the review handoff.

## The recommendation

Make the application own its product, and make the starter maintain a small set of explicit behavioral contracts. Begin by exposing customization seams and collecting upgrade evidence. Extract independently released packages only where a substantially customized consumer proves that the boundary works.

A sidebar is a presentation choice. Valid sessions, server authorization and safe configuration are behavioral obligations. A downstream game should be able to discard the former while keeping the latter. Directory names alone cannot express this distinction.

Three immediate conclusions:

1. **Adopt the separation principle.** Give business code, branding and strings an obvious home before cloning. Introduce boundaries incrementally; do not start with a repository-wide move.
2. **Evolve “starter version” into provenance plus adoption state.** An app can adopt one capability fix and defer another. A single version number cannot accurately describe that mixed state.
3. **Make uncertainty visible.** “The plan is deterministic,” “the package manager accepts this graph,” “the tests passed,” and “the application is secure” are different claims. The tool should report the evidence it has, not silently promote one claim into another.

## What the current starter actually gives us

| Area | Observed implementation | Consequence |
|---|---|---|
| Shared platform code | Private source workspaces in `packages/auth` and `packages/backend`; frontend backend exports include the generated API and data model | Useful reuse, but no independent auth/backend release contract |
| Application UI | Web project/task experience; admin shell and navigation; standalone dispatch demo | These are reference products, not a universal product shape |
| Authentication | Shared transport/client/provider plus app-specific proxy, server layout and reactive guard | Replacing the visible screen must preserve several behavioral layers |
| Persistence | One host schema mixes profiles, settings, invitations, announcements, audit and example projects/tasks/uploads | A whole-file ownership label would be misleading |
| Package upgrades | One independently built local sidebar-policy artifact with fixed destinations, plan/apply/verify/audit and a real demo rehearsal | Strong bounded precedent; does not certify the rest of the starter |
| Ownership | Demo has an exhaustive manifest; inventory explicitly labels backend, i18n and UI packages as mixed legacy areas | Reuse the lesson, not an unsupported global “protected” label |
| Release identity | Root version is `1.0.0`; preparation/publication tooling exists | Source alone does not establish publication. A prepared version is not an available baseline |
| Branding | Shared tokens and icons; translated names/metadata; backend email identity elsewhere | No single branding contract; shared icon copies overwrite generated app destinations |
| Localization | Fifteen shared catalogs, request configuration, static loaders, RTL handling and a Git conflict resolver | Shared and business text still overlap; an app override composition API is missing |
| Dependencies | Workspace manifests, root overrides and Bun lockfile, Renovate and migration policy | Package manifests must be considered together, not merged independently |

Evidence: [auth exports](../packages/auth/package.json), [backend exports](../packages/backend/index.ts), [schema](../packages/backend/convex/schema.ts), [web guard composition](../apps/web/src/app/[locale]/(dashboard)/layout.tsx), [app provider](../packages/auth/src/provider.tsx), [existing upgrade tool](../scripts/starter-upgrade/upgrade.ts), [ownership inventory](../scripts/starter-upgrade/ownership.json), [demo manifest](../apps/demo/starter-upgrade.json), [release tooling](../scripts/release.ts), [asset copier](../scripts/copy-shared-assets.sh), [message loader](../packages/i18n/src/request.ts), [root manifest](../package.json).

The existing general adoption mechanism remains the procedure in [UPGRADING.md](../UPGRADING.md). This document proposes a successor contract; it does not silently change today's supported commands.

## 1. Model ownership and obligations separately

The brief's six categories capture useful concepts, but overlap: configuration can be business-owned, replaceable UI is usually business-owned, and an extension point is an interface rather than an owner. **Proposed:** record two dimensions.

| Dimension | Values | Meaning |
|---|---|---|
| Source management | `maintained`, `application`, `generated`, `unclassified` | Who edits the bytes and how they receive updates |
| Contract role | capability implementation, composition, extension, configuration, reference UI | What responsibilities the path has |

Add provenance separately for copied material: origin, version/commit and content digest. An editable copy is application-owned with provenance. It is not a managed package merely because it began there.

A maintained path is not immutable. A local edit changes its state to **diverged** and removes automatic replacement eligibility. The app may propose an upstream fix, retain a reviewed patch, or deliberately take ownership. Each choice should explain future update responsibility. None should make security alerts disappear.

Unknown files must be reported before an apply operation. For initial adoption, classify business code explicitly; never guess that every new path is safe to overwrite. Avoid a generic `generated/**` escape hatch: generated outputs need named producers and bounded paths.

Ownership inspection can prove exact maintained-file drift against retained baselines and enforce declared import boundaries, such as platform code importing application modules or consumers using private exports. Exact-copy hashes can identify known copied artifacts. Similarity detection and suggestions that “business logic lives in core” remain advisory heuristics: they cannot reliably recover intent from arbitrary code. Give each diagnostic its evidence and confidence; do not grant overwrite authority from a classifier's guess.

### Recommended source organization

Keep the monorepo. Use its existing application/package boundaries, then improve the places where responsibilities are mixed:

```text
apps/web/
  src/app/                 application-owned route and provider composition
  src/business/            proposed home for product behavior and views
  src/branding/            proposed typed identity and metadata adapters
  branding/                proposed app-owned icon source files (PR #148)
  messages/                proposed business catalogs and starter overrides
packages/
  auth/                    maintained transport/session behavior; extract policy seams
  backend/convex/          host composition; split platform and business modules locally
  design-system/           primitives and tokens; classify policy-bearing components
starter/                   proposed adoption records and reviewed contract metadata
```

These are directions, not a mandatory mass rename. Next.js still needs route composition in the app; Convex still has a host composition root and generated types. Splitting schema fragments without changing table names can reduce textual overlap, but does not isolate storage or deployment.

### Concrete ownership decisions

- Business teams own dashboard layout, navigation, workflows, business tables, domain authorization and product copy.
- Starter maintainers own supported session transport, generic principal/policy contracts, and shared security behavior.
- Application teams assemble providers/routes and choose policy through supported interfaces. Their composition must pass applicable contracts.
- Shared UI primitives may be consumed through public exports or copied with provenance. Wrappers are useful while customization stays within the public API; do not create layers of wrappers around every component automatically.
- Generated Convex files remain generator-owned. Their presence does not grant permission to rewrite the business schema.
- Deployment mappings, secrets and live data remain outside source-upgrade mutation authority.

## 2. Separate capabilities from screens

**Proposed:** a capability describes behavior, dependencies, data, configuration and verification. Authentication, invitations, announcements, audit capture and storage are candidates. “Dashboard” is an optional reference presentation.

Define three levels of promise for an optional capability; presentation and policy choices can coexist:

| State | Promise | Example |
|---|---|---|
| Presentation omitted | No provided UI is rendered | Custom app omits the announcement banner |
| Policy disabled | Server operations reject or disable the behavior | Public signup disabled by policy |
| Not installed | Routes, code/config obligations and integration are absent as specified | Minimal product has no announcement capability |

Do not call hiding a menu item “uninstalling.” Existing invitation checks participate in authentication; existing attachments belong to projects; audit capture and its admin viewer need separate choices. An omitted screen does not prove that its queries or endpoints are absent.

Start with typed static composition and explicit adapters, not a runtime plugin marketplace. Limit the supported capability combinations until tests cover them. An application may replace enrollment screens, but must provide reachable destinations and keep direct backend enforcement where the contract requires it.

### Persistence alternatives

| Option | Benefits | Cost and decision |
|---|---|---|
| Local schema/function fragments | Small migration risk, fewer shared-file edits, same table identities | Recommended first experiment; still one host schema and deployment |
| Convex Components | Stronger API/data boundaries | Investigate per capability after contracts; requires data and ID migration, configuration and transaction analysis |
| Package the whole backend now | Simple-looking dependency update | Reject as a first step: current host-schema and optional-feature coupling becomes a public API burden |

Convex documents isolated component functions and data access boundaries. That supports investigating components; it does not prove that today's host tables can be moved without migration. [Convex component authoring](https://docs.convex.dev/components/authoring).

## 3. Record a truthful baseline

**Proposed:** separate four identities:

1. Starter release: immutable upstream commit/artifact and its human version.
2. Contract schema: format the tooling can parse.
3. Tool release: exact executable identity and supported source/target formats.
4. Application adoption: what was actually applied and verified.

Illustrative data, **not an accepted file format**:

```json
{
  "schemaVersion": 1,
  "starterId": "tkarakai/web-app-starter",
  "baseline": {"release": "vX", "commit": "full-immutable-sha"},
  "capabilities": {
    "identity": {"contract": "identity/1", "sourceDigest": "sha256:..."}
  },
  "adoptions": [{"target": "vY", "status": "partial", "report": "reports/upgrade-id.json"}],
  "exceptions": [{"id": "app-shell", "kind": "presentation-replaced", "owner": "application"}]
}
```

Do not advance the whole baseline to Y after taking only a security patch. Retain the old complete baseline plus individual adoption/deferral records; a fully verified transition can advance it. The sidebar package's `1.0.1` is a separate identity from starter release `1.0.0`.

For each compared path or capability, derive the effective adopted source from the complete baseline plus evidenced adoption records, including source/artifact identities and action receipts. Record how each selected change maps to the next comparison. If overlapping adoptions cannot be reconstructed unambiguously, report enrollment/review required for that scope instead of inventing a uniform A. A prior migration is reusable only when its implementation identity and applicable postconditions remain valid. This can initially be a refusal rule rather than a general patch-replay engine.

An exception needs its affected capability/path, owner, rationale, review trigger and validation impact. Time-limited security exceptions need an expiry; harmless shell replacement need not pretend to expire weekly. Broad wildcard exceptions should not suppress all future changes.

If Git history is missing, do not infer a baseline from `package.json.version`. Support an explicit enrollment report with known source provenance and measured differences. Ambiguous origin means analysis can continue, but automated replacement cannot.

## 4. A plan-first upgrade protocol

### Tooling first, but not an unpinned “latest” command

The brief is right that old tooling may not understand a new release. **Refinement:** first identify A and C with minimal trusted inspection; then select a pinned compatible tool using a declarative compatibility manifest. Run it separately from the app's dependency installation. A newer tool must declare supported schema versions, runtime requirements and migration edges. If no bridge exists, explain the required intermediate tool/release.

Do not execute shell commands supplied by incoming release metadata. Resolve known migration/check IDs through reviewed tooling. Content hashes bind inputs; authenticated release provenance is a separate trust question. Hashing malicious metadata does not make it trusted.

### State machine

```text
observed → planned → applied/pending → verified → adopted
               ↘ stale/refused          ↘ failed/incomplete
```

**Plan inputs:** immutable old source A, exact business tree B, target C, ownership map, dependency state, capabilities, exception set and tool identity. Include application source and lockfile digests. A plan is stale if any relevant input changes.

**Plan output:** exact scope and write candidates, reasons, conflicts, migrations, unresolved decisions, required validations and preserved application paths. Use named statuses such as `candidate`, `review`, `blocked`, `unchanged`; avoid “safe” when compatibility has not been executed.

**Reconcile before approval:** resolve ownership, dependency, configuration, branding and message choices into exact edits or unresolved decisions. An applicable scope contains no unresolved decision affecting its edits or their dependency closure. An unrelated blocked capability may remain deferred in a partial upgrade. Git can supply source transport and textual merging; structured adapters or explicit review supply semantic decisions.

**Apply:** require a clean isolated branch and approved unchanged plan. Check all preconditions before mutation, constrain write destinations, journal progress and mark adoption pending. Preserve all application-owned bytes except exact edits explicitly approved in the plan, such as migrations or manifest reconciliation. No release tags, deployment, cloud configuration or live database writes belong here. Recheck declared resolution after apply; if it requires different choices or unexpected source edits, retain pending status and produce a revised plan before applying those changes.

**Verify:** execute capability checks plus the application's own business suite against the resulting tree. Retain command identity, source/tool/lock digests, result and logs. Skipped or unavailable checks are not passes. Source readiness and live migration/deployment readiness are distinct reports.

Check IDs resolve to reviewed commands, but those commands execute downstream scripts and dependencies. Use reviewed inputs in an isolated test environment with fixture services and no production credentials. Bind relevant workspace/root configuration, lock/resolution, runtime/tool closure, test implementations and resulting source identity. Command names alone are insufficient; name unbound execution inputs instead of claiming hermetic verification.

**Adopt:** write a record bound to the verified source. Store prior/target identity, selected/deferred changes, local decisions, migrations, dependency changes, exceptions and exact evidence. A later edit invalidates current-tree verification for checks whose inputs changed; it does not erase the historical fact that the earlier tree adopted a release.

### Failure and recovery behavior

- Dirty source or changed plan: refuse before writing and regenerate the plan after review.
- Unknown migration or unsupported baseline: stop that transition; never skip silently.
- Interrupted filesystem apply: retain pending journal; resume only after validating expected before/after bytes, otherwise restore through ordinary version control.
- Schema/data migration: require separate environment-specific authorization, backup/recovery plan, idempotent progress and old-data fixtures. A Git revert does not reverse a database migration.
- Failed validation: retain the failure, do not update adoption to verified.
- Concurrent apply: lock per app; reclaim a stale lock only after proving its owner is no longer active.

Do not promise arbitrary version skipping. Support explicit migration graph edges; a planned path may traverse intermediate migrations without requiring a human to check out every release. Missing or ambiguous paths require review.

## 5. Dependency reconciliation: preserve intent without inventing compatibility

Use A = old starter, B = business, C = incoming starter, per workspace and dependency section. Inspect root policy and the resolved Bun graph too. Bun applies overrides from the root manifest, so app-level comparison alone misses effective versions. [Bun overrides](https://bun.sh/docs/pm/overrides).

| Situation | Proposed decision before validation |
|---|---|
| B equals A; C changes a supported dependency | Candidate incoming update, subject to lock resolution and checks |
| C equals A; B changed | Preserve downstream intent; flag unsupported compatibility where relevant |
| B equals C | Converged declaration; still not proof of installed bytes |
| Both changed differently | Review; never silently choose the numerically highest value |
| B uses a newer major than C | Preserve B pending compatibility review; do not downgrade automatically or declare it compatible |
| Dependency removed by one side | Review removal against downstream usage and capability requirements |
| Root override, peer, engine or package-manager policy changed | Review the connected dependency group |
| Workspace/file/git/alias/catalog/prerelease or complex range not understood | Report unsupported analysis explicitly; do not coerce into a version |
| Security requirement is unmet | Block adoption for the affected capability until fix or explicitly authorized exception |

Version ranges express declared compatibility, not proven API compatibility. A resolved version can satisfy an incoming range and still fail behavior tests. A higher major may intentionally drop APIs the starter needs. Treat React/React DOM, the auth adapter/plugins, Convex/testing libraries and Tailwind/PostCSS as connected groups; include application-introduced peers and plugins.

The smallest useful implementation is a **read-only three-way manifest report**: deterministic change classification, input hashes, unsupported/ambiguous cases, and no installs or writes. Start with explicit snapshot bundles and Node built-ins, no inferred baseline, and compatibility/security always marked not assessed. It should say “declaration candidate,” not “compatible.” Full semver/lock/peer/security reconciliation is a later adapter backed by the real package manager and compatibility suite.

Security constraints should reference a reviewed advisory/fixed range, not just a target version or urgency label. Maintain the starter's dependency age, migration and runtime policies when changing this repository; downstream policies belong to the application and must not be automatically replaced. The brief's React 20 illustration is hypothetical, not a request to change this starter's runtime.

## 6. Branding as an application-owned surface

Use per-app composition over a giant mandatory global configuration. Some products share a brand across marketing, app and admin; others deliberately do not.

| Surface | Proposed home | Rules |
|---|---|---|
| Icons | `apps/<app>/branding/` source → generated public icons | Fixed supported filenames; app override first, shared fallback; source is tracked |
| Product/company identity and metadata | Typed app branding module, optional shared business brand module | Separate localized display names from stable auth issuer/credential identities |
| Colors, radius, typography | App token layer after shared defaults | Preserve contrast, dark theme and RTL coverage |
| Images, social cards, logos | App assets with explicit metadata adapters | No silent copying of starter defaults over application assets |
| Legal/footer copy | Business catalogs and app page composition | Starter updates do not decide business legal content |
| Auth/email presentation | Explicit template/context adapter | Keep session/enrollment behavior; configure backend identity independently |

The proposed icon override contract is implemented for review in [PR #148](https://github.com/tkarakai/web-app-starter/pull/148), not in the inspected baseline; check the PR for current validation/merge state. It is intentionally small. It does not claim that adding one config object solves email transport, social metadata, translated names, fonts or legal content. Partial icon overrides fall back per file; use all three formats to avoid mixed browser branding. Removal deliberately restores a shared default.

## 7. Localization: three layers and a key contract

**Proposed resolution order:** starter messages → approved application overrides → business namespace. Business keys should be a distinct namespace, not arbitrary collisions with starter keys.

Use one composition function for dynamic request configuration and static export loaders. It validates nested shape, supported locale, collisions and override targets. Preserve existing key names initially; a bulk rename to `starter.*` is a breaking migration, not a prerequisite for separating source files.

The starter should ship a key contract describing required keys, interpolation parameters, rich-text tags and deprecations. Checking every locale against English catches missing translations but cannot catch a key deleted from all catalogs. Compare overrides against both source and target contracts during planning.

- New starter key: use target starter default; report missing translations according to the app's locale policy.
- Removed key with downstream override: report stale override; do not silently discard business copy.
- Renamed key: migrate only with an explicit old→new map and compatible message signature.
- Changed placeholders/plurals/tags: require translation review even if the key survives.
- Duplicate source keys: reject at parse time where possible; ordinary JSON parsing loses the evidence.
- Business-only locales: validate a deliberate fallback/completeness policy. Do not claim translated output when it falls back to English.
- RTL: verify direction on initial HTML where applicable, navigation, dialogs and custom layouts; catalog completeness does not prove usable RTL.

Keep the existing Git i18n resolver for legacy apps during adoption. New override composition should not retroactively classify all existing edits as supported overrides.

## 8. Validation contracts before broad automation

Start with a small capability matrix. Each claim needs a public/executable behavior oracle.

| Contract | Required evidence |
|---|---|
| Identity/session | Real sign-in/sign-out, revocation, refresh transitions, anonymous direct URL, ban and app/admin role behavior |
| Authorization | Real query/mutation calls for owner and non-owner; denied writes leave data unchanged |
| Enrollment policies | Required setup reachable through custom routes; no loops; direct APIs satisfy the declared enforcement policy |
| Branding | Generated icon bytes use application sources; defaults still update untouched apps |
| Localization | Merge/override behavior, placeholder validation, stale keys, initial/runtime direction and locale switching |
| Runtime configuration | Correct request-time backend selection; no accidental build-time pinning of environment-specific values |
| Ownership/app preservation | Before/after hashes plus actual business behavior; both are needed |
| Migration | Old-data fixtures, repeat/resume behavior, unknown-step refusal and recorded progress |
| Dependency adoption | Frozen install/resolution, peer/framework group checks, build/types and actual affected behavior |

Source inspection is insufficient to certify every current test as strong. Some existing tests exercise helper logic or conditionally assert a screen. Strengthening actual endpoint and session flows is a prerequisite to promising freely replaceable authenticated presentation. Treat suspected gaps as investigation targets, not as a completed security audit.

There is no single universal `starter validate` pass. Output a capability-by-capability matrix: pass, fail, not applicable, not run, unsupported. The exit status should fail when a required contract is failed or unproven.

## 9. Agent stress tests as a controlled comparison

Run contrasting applications against the same pinned baseline and incoming changes. Record prompt, agent/model, configuration, attempts, elapsed time, touched paths and evidence. These experiments measure agent usability of the architecture; deterministic tests remain the regression gate.

| Experiment | Application task | Incoming change | Success measure |
|---|---|---|---|
| E1: familiar dashboard | Service-case inbox with business rules | Maintained session fix | Business rules and session tests pass; no reset of app views |
| E2: mobile workflow | Bottom navigation, custom account routes | New required enrollment policy | Enrollment works without sidebar/dashboard assumptions |
| E3: fullscreen game | Authenticated game UI, no app shell | Session revocation fix | Direct protected access denied after revocation; custom UX retained |
| E4: branded multilingual app | New brand, Arabic/Hebrew, overridden auth copy | New/renamed message keys and icon changes | Brand preserved; stale overrides reported; RTL works |
| E5: enterprise domain | Organization membership and approvals | Profile/schema update | Membership access enforced; business records retained |
| E6: dependency divergence | App independently on newer major | Starter updates same dependency | No automatic downgrade or unsupported compatibility claim |
| E7: deliberate refusal | Remove invitation storage but retain invitation-only signup without replacement | Any update | Clear unsupported contract report; no deletion of checks to get green |

Compare variations on the same scenario: app-owned views plus headless behavior versus maintained views with slots. Score preserved behaviors, unauthorized writes, unresolved decisions, core edits, manual interventions and upgrade effort. Do not reward fewer Git conflicts if business behavior is lost. Use several runs before claiming one design improves agent reliability.

These are planned experiments, not claimed completed builds of seven applications. First ship the observation/validation seams, then run the smallest two contrasting consumers. Do not grow seven permanent example apps or adopt a plugin architecture merely to conduct the study.

## 10. Distribution choices and staged implementation

| Choice | Use when | Recommendation |
|---|---|---|
| Git tags/source | Legacy apps and mixed composition still need source changes | Keep as current transport; layer planning/evidence over it |
| Versioned packages | Public API works for genuinely different consumers | Extract narrow proven behavior, not every existing workspace |
| Editable copy registry | Local component customization is the product requirement | Later experiment: provenance + upstream diff/advisory responsibility; no automatic equality claim |
| Template scaffold | Creating a new app | Seed business-owned surfaces and enrollment metadata; do not treat re-scaffolding as upgrade |
| Release artifacts | Deliver immutable tool/catalog/migration inputs | Pin identities and provenance; commands remain in trusted tooling |

Suggested implementation sequence, reconsidered from this brief:

1. **Small PRs now:** app-owned icon overrides; conservative dependency planning report; meaningful behavioral tests where an existing invariant is under-specified.
2. **Review next:** two-axis ownership/adoption schema and scoped capability registry. Keep metadata small: implement only fields consumed by the first check; keep future ideas in prose.
3. **Prototype:** shared message composition with override diagnostics; app-owned screen composition around maintained identity behavior.
4. **Run E2/E3 plus E4:** first define common fixture enrollment, pinned baseline and pass/fail preservation oracles; then compare radically different presentation and localization without broad package extraction.
5. **Define the first end-to-end app contract:** pinned baseline, stale-plan rejection, preservation, required checks and retained report; prove on a customized app.
6. **Then select distribution boundaries:** package the behavior that survives the experiments; trial backend fragments before any storage relocation.

This order intentionally changes the brief's “manifest first” emphasis: establish enough observable behavior to avoid encoding a confident but incorrect ownership map. Metadata and contract tests should grow together.

## Reviewable implementation starting points

These independent PRs are implementations of bounded ideas, not approval of the whole architecture. They remain separate from the inspected baseline; consult their checks and merge state before treating them as available features.

| PR | Concrete result | Deliberate limit |
|---|---|---|
| [#148: app-owned icon overrides](https://github.com/tkarakai/web-app-starter/pull/148) | Tracked app inputs survive shared-asset updates; invalid overrides fail before copying | Three icon formats, existing app list; not a complete branding provider |
| [#149: offline dependency comparison](https://github.com/tkarakai/web-app-starter/pull/149) | Explicit A/B/C snapshot bundles produce deterministic intent and conflict diagnostics without changing the app | Compatibility/security are not assessed; no resolver, install, apply or baseline advancement |
| [#150: backend authorization contracts](https://github.com/tkarakai/web-app-starter/pull/150) | Registered query/mutation tests cover anonymous, owner and non-owner behavior plus data preservation | Emulator evidence; no production behavior change and no claim of complete browser/session coverage |

The authorization work includes a negative control: temporarily bypassing the upload-deletion ownership guard makes its denial test fail, then the original production bytes are restored and the contracts pass. This is test-quality evidence, not a shipped bypass. The report prototype also tests standalone execution without app dependencies, malformed-input refusals and side-effect restrictions.

UI ownership variations, message-layer composition and the broader stress applications remain proposed experiments. These first PRs make subsequent experiments easier to measure without committing to a universal shell, a large platform package or a backend storage migration.

## Decisions for review

| ID | Recommendation | Alternative worth testing | What would change the recommendation? |
|---|---|---|---|
| D1 | App owns views; platform owns behavior contracts | Maintained views with slots for common screens | Evidence that most consumers need only small layout changes |
| D2 | Local backend fragments before component migration | Isolate one optional capability in a Convex Component | Demonstrated storage/config migration and clear independent lifecycle |
| D3 | Per-app branding/message composition with optional shared business module | One central business configuration for all apps | All consumers require one synchronized brand and locale policy |
| D4 | Incremental package extraction plus Git for mixed source | Broad versioned platform package | Two very different consumers prove an API that stays narrow |
| D5 | Preserve dependency declarations while unresolved compatibility stays review | Automated semver/peer candidate solver | Real resolved-graph and behavior evidence, including newer downstream majors |

## Coverage of the original brief

| Brief ideas | Treatment in this design |
|---|---|
| 1–2: long-lived relationship and desired outcome | Adopted; recommendation and measurable contract evidence |
| 3–4: separation before clone and UI freedom | Adopted; source organization, app ownership and screen/capability separation |
| 5: agent stress testing | Adopted; E1–E7 with fixed baselines, oracles and honest completion labels |
| 6: ownership categories | Refined into source management plus contract role |
| 7: validation/tooling first | Adopted with pinned compatible bootstrap and explicit trust boundary |
| 8: versioned starter identity | Extended with immutable provenance, partial adoption and capability identity |
| 9–10: branding and localization | Adopted; per-app layering, tracked assets, key/message contracts |
| 11: dependencies | Adopted; reject numerical precedence as compatibility proof |
| 12–14: process and AI contract | Concrete plan/apply/verify/adopt protocol with agent boundaries |
| 15: machine-readable concepts | Adopt incrementally; avoid unused registries and duplicate version authorities |
| 16: intentional divergence | Adopted; explicit ownership transitions and reviewable exceptions |
| 17: semantic three-way model | Adopted for structured domains; uncertain semantics stay review |
| 18–19: workstreams/order | Reordered around small seams, evidence and contrasting consumers |
| 20: unresolved questions | Concrete recommendations and D1–D5 experiments |
| 21–22: success and guiding principle | Preserved; accurate adoption record plus proven business behavior |

A future upgrade agent may autonomously inspect, plan, apply reviewed deterministic changes on an isolated branch and run tests. It must surface unknown baselines, unresolved dependency groups, protected behavior changes, data migration decisions and missing evidence. It may not redefine ownership or weaken tests simply to make an upgrade pass. Reviewable PRs are the delivery boundary; release publication and deployment remain separate operations.
