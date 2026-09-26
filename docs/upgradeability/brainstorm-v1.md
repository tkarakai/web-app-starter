# Starter upgradeability — brainstorm (v1)

**Version:** v1, 2026-09-25 · Tamas Karakai
**Source:** exported from the Claude Doc "Starter upgradeability — brainstorm". Kept as written; superseded by [v2](brainstorm-v2.md).

## The goal, from the business app developer's seat

The goal is not "upgradeable code". A paying developer should get **continuing value** from the starter after day one, and that value must cost less than doing the same work themselves.

The starter is sold under a commercial license, so the developer is a customer. They bought a head start. They will keep paying attention to upgrades only if the upgrades carry things they could not cheaply do alone.

What they actually want from an upgrade, roughly in order:

1. **Security and auth fixes**, fast and without fear. This is the non-negotiable one: an auth bug in Better Auth wiring or session handling is the starter's liability as much as theirs.
2. **Dependency and runtime hygiene** (Next, React, Convex, Better Auth majors) done by someone who already paid the migration cost.
3. **Platform capabilities** they did not build yet: MFA policy, audit trail, rate limits, waitlist, invitations, ops tooling.
4. **Infrastructure and CI** improvements: deploy pipeline, AWS target, security workflows.
5. **UI polish** to the default shell. By far the least valuable once they have their own product look.

What they do **not** want:

- Their product to look or behave like the starter.
- To learn a bespoke upgrade system before they can ship.
- An upgrade that silently changes their data, auth behaviour or deployed config.
- To be punished (in merge conflicts) for the ordinary things every app does on day one: rename, rebrand, delete the sample.

**The test for every idea below:** does it lower the cost of getting starter fixes, improvements and new features into a real, diverged app? If it mostly helps the starter maintainer feel in control, it is secondary.

**Decided: the promise covers fixes, improvements and new features, with no time limit.** That makes the boundary system the core deliverable, not a nice-to-have. Fixes can travel through consumed code. A new feature also needs a known way into an app whose UI the starter no longer controls (topic 14).

One reframe runs through the rest of this doc. The cheapest merge is the one that never happens. Every line of starter code sits in one of three states downstream:

| State | Who changes it | Upgrade cost |
| --- | --- | --- |
| **Consumed** (installed as a versioned package or service) | Starter only | Near zero: bump a version, run checks |
| **Owned** (copied once, then the app's code) | App only | Zero by definition; the starter can only offer advice |
| **Shared-and-edited** (lives in the app tree, both sides change it) | Both | All of the pain |

Most of the upgrade problem is the size of the third row. Tooling can make that row survivable. Architecture can make it small.

## A critical reading of the handoff

The handoff has the right instincts and the wrong centre of gravity. It spends most of its words on upgrade machinery (manifests, planners, semantic three-way merge, dependency resolvers). It spends few on the thing that decides whether that machinery is needed: how much of the starter a business app has to edit.

### What it gets right

- **Separation before the clone** (§3). The single highest-leverage idea in the brief.
- **Don't assume the app looks like the starter** (§4). Correct, and more radical than it reads: it means the dashboard shell is a sample, not a platform.
- **Don't over-protect** (§16). "Make upgrade cost visible" beats "forbid edits". Keep this as a design rule.
- **Validate before you upgrade** (§19.4). Proving the contract is intact is more valuable than automating the merge.
- **Agents as stress tests** (§5). With no real business app, this is the only source of evidence available.

### Where it is weak or risky

- **Machinery before evidence.** Nine workstreams, a manifest schema and a semantic merge engine, all designed for a consumer that does not exist yet. The likely outcome is tooling tuned to imagined apps.
- **Code-only view of an upgrade.** It never mentions data. This is a Convex app: starter tables (`userProfiles`, `auditTrail`, `waitlistEntries`, invitations) live in production deployments. A schema change there is a data migration against the customer's live database, with ordering constraints against the code deploy. That is the riskiest part of any real upgrade and it is absent.
- **Also absent:** environment variables and secrets, Convex env (`SITE_URL`), Vercel project settings, GitHub workflows, and deploy ordering. An upgrade that merges cleanly but needs a new secret will fail in production, not in the merge.
- **Dependency reconciliation is over-engineered** (§11). The example output is a hand-rolled package resolver. Package managers already solve constraint satisfaction; the gap is that the starter publishes *pins*, not *requirements*.
- **"Protected" is undefined.** Immutable? Discouraged? Linted? The brief says both. Pick one: visible cost, not enforcement.
- **No notion of *why* to upgrade.** The developer needs an advisory ("auth session fix, severity high, affects v1.0–v1.2") before any tool. Without it, upgrades happen only when someone is bored.
- **Upgrade-the-upgrader first** (§7) is right, but it is a symptom. If the upgrader needs upgrading to understand the next release, the upgrader is doing too much.

### What it is really asking

Strip the tooling and three questions remain:

1. **Where does starter code stop and app code start?** (architecture)
2. **How does a developer know the starter still works inside their app?** (behaviour contract)
3. **How does a change travel from starter to app?** (distribution)

The brief answers 3 in detail and 1 and 2 only in outline. The order should be reversed.

## Evidence: lifeor2-client

One real app exists, and a trial upgrade of it gives **28 conflicted files and two silent runtime breaks**. Almost all come from missing seams (config knobs, branding, agent docs) and a hand-ported fix, not from the product code, which merged cleanly. The full analysis is in [`case-study-lifeor2-client.md`](case-study-lifeor2-client.md).

## Topics, argued

Each topic has the idea, the argument against it, how it evolves, and a verdict. Observations about the current code are marked **In the code**.

### 1. Ownership boundaries

**Idea (§3, §6).** Label files as core, extension point, business-owned, generated, config or replaceable UI, in a manifest.

**Against.** Six categories is a taxonomy, not a boundary. A manifest that labels the whole tree will drift, and a label does not stop a conflict. Labels only matter for the shared-and-edited row; consumed and owned code need none.

**Evolve.** Use the three states from the goal section and try to move every area into "consumed" or "owned". A first cut for this repo:

| Area | Natural state | Why |
| --- | --- | --- |
| `packages/auth`, `edge-rate-limit`, `ops` | Consumed | Pure platform, no product look |
| Backend platform functions (auth, sessions, audit trail, rate limits, waitlist, invitations, app settings) | Consumed | Security-critical; exactly where fixes land |
| Design-system primitives | Consumed, restyled by tokens | Apps restyle, rarely rewrite a dialog |
| **Admin app** | **Consumed (decided)** | Used as-is, with theming and feature switches; this is also why it is not localized |
| CI/CD workflows | Consumed, as reusable workflows called by thin app files | Today they are copied files both sides edit |
| `landing`, `landing-static` | Owned from day one | Pure marketing; nobody wants starter copy updates |
| Web dashboard and sample domain | **Owned from day one (decided)** | It *is* the product |
| Web auth pages and settings | Shared-and-edited (for now) | Mixes platform behaviour and product look |
| `schema.ts`, `http.ts`, `convex.config.ts`, root `package.json`, `turbo.json` | Shared-and-edited | Single files both sides must touch |

**Verdict.** Keep the goal, drop the six-way taxonomy. A small list of shared-and-edited files, each with a reason and a shrink plan, is worth more than a full manifest.

### 2. The sample domain is the first thing every app deletes

**New topic, not in the brief.** Day one for every buyer is the same: rename, rebrand, delete the sample. If those three create conflicts on every later upgrade, the starter punishes its most predictable use.

**In the code.** Projects, tasks and uploads are threaded through the platform. `AppSidebar` lives in `components/projects/`, so the shell is the sample. `projects` and `tasks` tables sit in the same `schema.ts` as `userProfiles` and `auditTrail`. The `projects`, `tasks`, `uploads` and `dashboard` message namespaces sit in the same locale files as `auth`.

**Evolve.** Make "remove the sample" a single, clean operation: the sample in its own folders, its own schema fragment, its own message file, and a shell that renders with zero sample code. Then test it: CI runs the starter with the sample deleted.

**Verdict.** Highest value per hour on this list. It needs no tooling and fixes the most common real conflict.

### 3. Apps that look nothing like the starter

**Idea (§4).** Separate platform capabilities from presentation.

**Against.** Full headless design (logic hooks plus swappable views for everything) is expensive and makes the starter harder to read, which hurts the day-one buyer.

**Evolve.** Go headless only where security fixes land: sign-in, sign-up, reset, verify, invitation, MFA, sessions. Those flows get a logic layer (hooks, error mapping, redirects) the app keeps, and a default view the app may replace. Everything else (dashboard, sidebar, settings layout) is sample UI: copied once, owned forever, and the starter says so.

**Verdict.** Decided: the dashboard is a sample. Headless work is limited to the auth flows; everything else is labelled as sample UI.

### 4. Behaviour contracts: prove the starter still works

**Idea (§7 validation, §13 invariants).** Check that critical starter behaviour survives in the app.

**Against.** Contract tests coupled to the starter's UI break the moment an app replaces that UI, and then they get deleted.

**Evolve.** Make contracts black-box and presentation-free, run against the app, not the starter:

- Auth: sign-in, session expiry, clear-session, banned user, admin blocked from the web app, MFA enforcement.
- Endpoint authorization for every Convex function (open PR #150 is exactly this shape).
- Security headers, rate limits, CSRF and origin checks.
- Required env present and valid.

Test through HTTP and Convex function calls, or through a tiny stable set of `data-testid` hooks the app promises to keep. The suite ships with the starter and upgrades with it.

**Verdict.** The strongest idea in the brief. If the contract suite is green after an upgrade, the merge method barely matters. Build this before any upgrade tool.

### 5. Distribution: how a change travels

**Idea (§20).** Git history, package, template release or artifact.

**Against each.** Git merge from upstream is honest and familiar but scales badly with divergence. Packages need a private registry gated by license. Copy-in registries (shadcn style) give no upgrades at all, only re-copies. Template regeneration fails once the app diverges.

**Evolve.** Pick per state, not globally:

| State | Mechanism |
| --- | --- |
| Consumed | Versioned packages (private registry per license, or git-tag dependencies to start) |
| Owned | Copy once at creation; later changes arrive as a written recipe or codemod the app may apply |
| Shared-and-edited | Git merge from the upstream tag, run by a human or agent, gated by contracts |

**Verdict.** Git merge is the right default now because it needs nothing new. The strategy is to shrink what it has to carry, one package at a time.

#### Exploring the channel for consumed code: registry or not

Still open. The real question is not "registry or git". It is: **how does a licensed buyer receive a versioned, readable, patchable unit of starter code, and can the starter take access away?** Four candidates:

| Option | Access control | Install and CI friction | Buyer can read and patch | Fits a monorepo starter | Main risk |
| --- | --- | --- | --- | --- | --- |
| **Git merge only** (no consumed code) | Repo access per license | None new | Fully: it is their code | Yes | Keeps everything shared-and-edited, which is the problem |
| **Git dependencies** (`github:org/repo#tag`) | Repo access per license | Token in every CI and deploy environment | Yes, source is installed | Poorly: package managers install a repo root, not a workspace folder | Needs one repo per package, or a split-out mirror |
| **Private registry** (GitHub Packages, npm org, self-hosted) | Token per customer; revocable | Registry config and token everywhere, including `act` and offline CI | If source ships inside the package; patch with `bun patch` | Yes: publish each workspace as it is | Running a license-gated registry becomes part of the product |
| **Vendored snapshot** (immutable, checksummed copy in the app tree) | None after delivery | None: it is files | Yes, but editing breaks the checksum | Yes | Updates are a file swap the upgrade tool must manage; easy to edit by accident |

**Arguments that cut across the options:**

- **Patchability is non-negotiable.** A buyer with a production incident must be able to patch consumed code that day. Any channel needs a documented patch path (`bun patch`, or an override folder) that the next upgrade detects.
- **Convex has its own answer for backend code.** Convex functions must live in the deployment's `convex/` tree. The supported way to ship backend code from a package is a **Convex component**, installed through `convex.config.ts`. So for the backend, "which registry" follows from "do we adopt components" (topic 10).
- **Revocation cuts both ways.** A registry can cut off an expired license, but that also means a lapsed buyer's CI breaks on the next clean install. That would feel hostile for a product sold as source.
- **Renovate works with all four**, but only registries and git tags give it a version to propose.

**How to decide.** Take one small, pure package (for example `edge-rate-limit`) through each viable channel into a throwaway app. Score it on: first install, CI including `act` offline mode, a Renovate bump, an emergency patch, and a license revoked. One day of work settles a question that argument cannot.

### 6. Starter identity and version

**Idea (§8).** The app records which starter version it is based on.

**Against.** Almost nothing. The only risk is recording the wrong thing.

**Evolve.** The version is for humans; the **base commit** is for tools. A git three-way merge needs the exact upstream commit the app last took, and once history is squashed or re-rooted, that is lost. Record both, plus the list of consumed package versions, in one small file the upgrade updates in the same commit.

**Verdict.** Do it now. It costs an hour and every later idea depends on it.

### 7. Branding

**Idea (§9).** One supported place for branding.

**In the code.** Branding is scattered:

- `appName` "Web App Starter" repeated in all 15 locale files, plus landing copy that names the product in prose.
- The TOTP issuer name hard-coded in `packages/backend/convex/auth.ts`.
- Icons in `packages/design-system/assets`, copied into five apps by `copy-shared-assets.sh` (the demo already opts out).
- Colour tokens in `packages/design-system/tokens/index.css`, which is starter-owned.
- Email templates in `emailTemplates.ts` with hard-coded hex colours and `lang="en"`, so they are neither branded nor localized.

**Evolve.** One app-owned brand module: product name, legal entity, support email, URLs, logo set, token overrides (as a CSS layer loaded after the starter tokens), email palette and footer. Starter code reads from it and never contains a product name. Product name leaves the message files and is injected as an ICU argument.

**Against the evolved version.** Some branding is structural (a landing layout, a sign-in page with a hero image). Config cannot express that, and should not try; that belongs to owned UI (topic 3).

**Verdict.** Very actionable, low risk, and it removes a conflict in 15 files plus the backend.

### 8. Localization

**Idea (§10).** Separate starter and business strings, with overrides.

**In the code.** `packages/i18n/src/request.ts` loads one `messages/<locale>.json` per locale. Starter namespaces (`auth`, `errors`, `passwordStrength`, `timezones`) share each file with sample and marketing namespaces (`projects`, `tasks`, `landing`, `legal`). Any app string added there conflicts with every starter string change.

**Evolve.**

- **One owner per namespace.** Starter namespaces live in starter files; app namespaces in app files; both are merged at load time.
- **Overrides are a separate, small app file** deep-merged over starter namespaces. Validation flags overrides of keys that no longer exist.
- **Locale subset.** The app picks which of the 15 locales it ships. The starter keeps translating its own keys into all 15: that is real value (auth copy in Hebrew and Japanese is exactly what apps do not want to write).
- **Renames ship as data.** A release lists renamed and removed keys, so tooling can move overrides instead of breaking them.

**Verdict.** Actionable now; the split is mechanical and the merge is a few lines in `request.ts`.

### 9. Dependencies

**Idea (§11).** A tool that compares versions and decides keep, upgrade or review.

**Against.** This is a package resolver written by hand. The downgrade scenario only happens because a merge overwrites `package.json` text.

**Evolve.** Change what the starter publishes: **requirements, not pins**. Each release states "starter code needs `better-auth` ≥ 1.6.30, tested with 1.6.33". The app owns its lockfile and its Renovate config. An upgrade then only checks: does the app satisfy the new minimums? If not, raise them; never lower anything. Consumed packages express this natively as peer ranges.

The hard case remains a starter major that changes APIs the app also calls directly (the brief's date-library example). No tool resolves that; the starter's migration note and the app's own tests do.

**In the code.** Root `overrides` pin `react`, `next`, `convex` and `typescript-eslint`. Those are a shared-and-edited hot spot and should become documented floors.

**Verdict.** Build the report ("your version vs starter minimum"), not the resolver.

### 10. Data, config and deploy (missing from the brief)

**New topic.** An upgrade is not only code. For this stack it also touches:

- **Starter tables** in the customer's live Convex deployment. A changed field on `userProfiles` or `auditTrail` is a data migration.
- **Env and secrets**: new variables across Vercel, Convex env and GitHub.
- **Deploy order**: schema and backend before apps, or expand-then-contract.

**Evolve.**

- Starter schema changes follow expand/contract, so any release can deploy code and data independently.
- Each release ships its migrations as idempotent Convex migrations with a check that reports whether they have run.
- Each release declares its required env, and a check fails before deploy if any is missing.
- A bigger bet: move starter tables into a Convex component so their schema is versioned apart from the app's. Worth a spike; the auth adapter makes it non-trivial.

**Verdict.** The first three are cheap discipline and protect the customer's data. The component idea is an architecture bet.

### 11. Recording deliberate divergence

**Idea (§16).** Keep a list like "default navigation replaced, dashboard shell removed".

**Against.** A hand-written ledger drifts within weeks. Nobody updates a list when they delete a folder.

**Evolve.** Prefer **disable, don't delete**. Starter features the app does not want (waitlist, invitations, announcements, admin onboarding) are switched off in config, not ripped out. Their code keeps receiving fixes and never conflicts. The "ledger" is then just the config, which is always true. For what cannot be switched off (replaced UI), derive divergence from the diff against the base commit instead of asking humans to declare it.

**Verdict.** Feature switches for optional platform features are actionable. The hand-written ledger is not worth keeping.

### 12. Agents: as stress testers, and as upgraders

**Idea (§5, §13, §14).** Agents build varied apps to reveal friction; agents perform upgrades under a written contract.

**Against.** Agent-built apps are not human-built apps. Agents read `AGENTS.md` and follow rules more literally than a hurried team, and they also edit anything without hesitation. Findings are a proxy, not ground truth. Also, one-off experiments teach once and then go stale.

**Evolve: turn the stress test into a standing upgrade benchmark.** This is the substitute for the business app that does not exist.

1. Agents build 4–6 deliberately different apps on starter vN: a conventional SaaS, a mobile-first app with no sidebar, a full-screen game-like app, a heavily branded single-locale app, an app that drops waitlist and admin onboarding.
2. The maintainer cuts a synthetic vN+1 with known, planted changes: an auth security fix, a starter-table schema change, new and renamed i18n keys, a dependency major, a new required env var, a default-UI change.
3. A fresh agent upgrades each app using only the shipped docs and tools.
4. Score each run: did the security fix land? Is the app's own behaviour intact? Is the contract suite green? How many human interventions? How many conflicts, in which files?

The conflict heat map tells you what to move into "consumed" next. Re-run it on every real release and it becomes a regression suite for upgradeability itself.

For the upgrader role, the brief's 12-step contract (§14) is sound. Its most important part is the **stop conditions**, which need to be concrete: a contract test fails; a starter-table migration touches rows; a secret is required; a conflict falls in auth or authorization code.

**Decided:** that stop list is the starting policy for unattended agent upgrades.

**Verdict.** The benchmark is the highest-value experiment available. Build the upgrader guidance as a skill that ships with the starter.

### 13. Upgrade planner and semantic three-way merge

**Idea (§7, §12, §17).** A tool that plans, classifies (auto, safe, conflict, judgment), applies and reports; eventually a merge more semantic than git.

**Against.** A general semantic merge engine is a research project. It would be the most complex code in the starter, maintained by one person, for customers who mostly want a security fix. And an agent with git, the diff, the release notes and a green-or-red contract suite already *is* a semantic merge.

**Evolve.** Split read from write:

- **Plan (read-only):** from the base commit and the target tag, report which changed starter files the app also touched, new env, migrations, dependency floors, i18n key changes, and the release's advisories. Cheap, safe, useful to both humans and agents.
- **Apply:** plain `git merge` of the upstream tag, done by a human or an agent.
- **Verify:** the contract suite, the app's tests, env and migration checks.
- **Report:** a short record committed with the upgrade, updating the identity file (topic 6).

**Verdict.** Build the planner and the verifier. Do not build the merge engine. Revisit only if the benchmark shows agents repeatedly failing at merges the planner could have resolved.

### 14. How new features reach an app that owns its UI

**New topic, forced by two decisions:** the promise includes new features, and the dashboard is owned by the app. So a new starter feature (say API keys, notifications or teams) cannot arrive as a merge into the app's screens. Those screens are not the starter's any more.

**Evolve: every feature ships in four parts.**

1. **Platform part (consumed).** Backend functions and tables, logic hooks, and the feature's own i18n namespace in starter-owned files. Upgrades like any consumed code.
2. **Default UI (an add-on, owned once taken).** The app pulls it into its own tree on demand, shadcn style. From then on it is the app's code.
3. **Wiring (a recipe or codemod).** The route, nav entry, settings tab and permission checks the app must add. Written as a short, testable recipe, because only the app knows where its nav lives.
4. **Switch (off by default for existing apps).** A release never changes an existing app's behaviour unasked. The feature's contract tests turn on with the switch.

**Against.**

- **Two code paths.** The starter's own apps get the feature built in, while buyers get an add-on. Both must be tested, or the add-on rots.
- **Cross-cutting features do not package cleanly.** Teams or organisations change who owns every row and every query. That is a migration with a guide, not an add-on.
- **Taken UI gets no improvements.** Once copied, the add-on is frozen. The starter can publish a per-add-on changelog so a human or agent can port selected changes, but nothing arrives automatically.

**Verdict.** This is the core of the "known system" the promise needs. Design it by piloting one real feature end to end, with the next feature on the starter's roadmap, before generalising.

## Explorations, clustered by actionability

The fourteen topics collapse into eight explorations. Two can start tomorrow with no open design questions. Two are short experiments that settle open choices. One is deliberately parked.

| Exploration | Topics | Actionability | First concrete step | Done when |
| --- | --- | --- | --- | --- |
| **A. Make day one free** | 2, 6, 7, 8, 11 | Do now: days, no design risk | Add the identity file; move the sample into its own folders, schema fragment and message file | A fresh app can rename, rebrand, drop the sample and switch off waitlist, then take the next release with zero conflicts from those changes |
| **B. Prove it still works** | 4, 10 | Build next: weeks, design is clear | List the auth and authorization invariants; land the endpoint authorization contract (PR #150) as the first shipped contract | One command runs presentation-free contracts, env checks and migration-status checks against any app |
| **C. Tell me why and what** | 9, 10, 13 | Build next: small tools plus release discipline | Every release note carries advisories with severity, new env, migrations and dependency floors | A read-only planner prints that list for an app's base commit and target tag |
| **D. Feature delivery into owned apps** | 3, 14 | Design next: pilot one real feature | Take the next roadmap feature through all four parts: platform, add-on UI, wiring recipe, switch | An app that deleted the sample can switch the feature on, pull its UI and pass its contracts |
| **E. Choose the consumed-code channel** | 5 | Experiment: about one day | Push `edge-rate-limit` through each viable channel into a throwaway app | Each option is scored on install, offline CI, a Renovate bump, an emergency patch and a revoked licence |
| **F. Evidence engine** | 12 | Experiment: needs A and B first | Build two contrasting agent apps (sidebar SaaS, no-sidebar full-screen) on the current release | The planted-change benchmark runs per release and yields a conflict heat map |
| **G. Shrink the shared surface** | 1, 3, 10 | Architecture bets: decide from F's heat map and E's result | Spike one bet: backend platform as a Convex component, or auth flows as headless logic plus default views | The hottest shared-and-edited area in the heat map becomes consumed or owned |
| **H. Parked** | 1, 9, 11, 13 | Not now, with a trigger to revisit | None | Revisit if F shows repeated failures these would have prevented |

**What is parked, and why:**

- **Semantic three-way merge engine.** An agent plus git plus contracts already covers it.
- **Full ownership manifest with enforcement.** Replaced by a short list of shared files with shrink plans.
- **Dependency resolver.** Replaced by published floors and a report.
- **Hand-maintained divergence ledger.** Replaced by feature switches and diffs against the base commit.

**Order.** A, B and E run in parallel. C grows out of B's checks. D needs A's clean sample removal, because an app with no sample is the test case for a new feature. F needs A and B to score anything. G waits for E and F. That order also answers the brief's "upgrade the upgrader first": if B and C stay small and read-only, there is little upgrader to upgrade.

## Open questions that unblock the rest

Five decisions shape everything above. Most can be answered in one conversation. None blocks exploration A.

1. **What is the product promise?** "Security fixes for N months after purchase" sets the scope of what must stay upgradeable. "All future improvements" sets a much larger one. The license tiers should say which.
   **Answer:** timescale is irrelevant for this exercise. Not just security fixes, also feature improvements, new features. That's why it is important to set boundaries and a known system to guide how we deal with all that.
2. **Is the web dashboard a platform or a sample?** Decided: sample, copied once and owned forever. Topic 3's headless work stays limited to the security-sensitive auth flows.
3. **Does the admin app stay consumed?** It is the most likely candidate to be used as-is. If buyers mostly keep it, treat it as a platform app with theming and switches, not as editable code.
   **Answer:** correct. The admin app is expected to be consumed. That's why it is not localized even...
4. **Private registry or git only?** Consumed packages need a license-gated channel. Git-tag dependencies work first; a registry is a purchase-flow question as much as a technical one.
   **Answer:** I do not know, we need to explore this with pros and cons of even using a package registry.
5. **How far may an agent go unattended?** A starting line: an agent may apply releases with no advisory above medium, no starter-table migration touching rows, no new secret and a green contract suite. Anything else stops for a human.
   **Answer:** Sure.

Also worth confirming once real buyers exist: whether they upgrade on a cadence or only when an advisory lands. The answer decides how much the planner matters compared with the advisories.
