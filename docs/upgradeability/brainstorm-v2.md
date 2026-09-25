# Starter upgradeability — brainstorm (v2)

**Version:** v2, 2026-09-25 · Tamas Karakai
**Supersedes:** [v1](brainstorm-v1.md), written before any real business app had been studied.
**New evidence:** [case study: lifeor2-client](case-study-lifeor2-client.md), the first real app built on the starter.

## What changed since v1

v1 reasoned from the starter's code alone. v2 has one real app to test it against. lifeor2-client was built by an agent told only to "build the app based on the web-app-starter". A trial merge of 9 days of starter changes gave **28 conflicted files and two silent runtime breaks**.

The evidence **confirms v1's direction and moves its centre of gravity**:

- **Confirmed:** sample-as-owned, admin-as-consumed, design tokens held up, starter identity matters, behaviour contracts are the priority.
- **Moved:** the biggest cost is not the sample or the shell. It is **missing seams**, the places where an ordinary app need (cookie name, ports, product name, docs) had no supported home, so the app edited starter code.
- **New:** apps take individual fixes early; fixes flow upstream too; the first contact (what happens when someone says "build on the starter") shapes everything after it.

**One app is one app.** Every lesson below carries a confidence level:

| Label | Meaning |
| --- | --- |
| **Seen once** | Observed in lifeor2-client; plausible but could be specific to it |
| **Expected generally** | Observed once, and the mechanism would apply to almost any app |
| **Reasoned** | From v1's analysis; not yet tested by a real app |

More apps are coming. The [evidence program](#the-evidence-program) below describes how each one gets studied the same way, so the conclusions firm up or get overturned.

## Decisions so far

| # | Decision | Source |
| --- | --- | --- |
| 1 | The promise covers fixes, improvements and new features, with no time limit | v1 open question 1 |
| 2 | The web dashboard is a sample: copied once, owned forever | v1 open question 2 |
| 3 | Headless work is limited to the security-sensitive auth flows | v1 open question 2 |
| 4 | The admin app is consumed, used as-is with theming and switches (that's also why it isn't localized) | v1 open question 3 |
| 5 | Unattended agent upgrades stop on: any advisory above medium, a starter-table migration touching rows, a new secret, or a red contract suite | v1 open question 5 |

Still open: the channel for consumed code (registry or not). See topic 5.

## The goal, from the business app developer's seat

Unchanged from v1. A paying developer should get **continuing value** from the starter after day one: security and auth fixes, dependency hygiene, platform capabilities, infrastructure, and new features. That value must cost less than doing the same work themselves.

**The test for every idea:** does it lower the cost of getting starter fixes, improvements and new features into a real, diverged app?

v1's framing still holds. Every line of starter code is in one of three states downstream:

| State | Who changes it | Upgrade cost |
| --- | --- | --- |
| **Consumed** (installed as a versioned unit) | Starter only | Near zero |
| **Owned** (copied once, then the app's code) | App only | Zero; the starter can only advise |
| **Shared-and-edited** (both sides change it) | Both | All of the pain |

### What the evidence adds: seams

lifeor2-client shows *why* code ends up shared-and-edited. The app did not choose to edit starter files. It edited them where the starter gave it **no seam**: no supported place to express an ordinary need. Where a seam existed (a schema spread, an HTTP route, design tokens) the agent used it, and those files merged cleanly.

So the practical question behind "shrink the shared-and-edited row" is: **what seams does every app need, and does the starter have them?** From the evidence so far, five kinds:

| Seam kind | What it carries | Evidence in lifeor2-client | Status in the starter |
| --- | --- | --- | --- |
| **Values** | Product name, ports, cookie prefix, origins, email sender, feature switches | 9 conflicts + 1 silent break | Mostly missing: literals repeated across files |
| **Registries** | Tables, HTTP routes, pages, nav entries, CI jobs | Schema and routes merged cleanly | Partly there: schema spread and `http.route` work; nav and CI don't |
| **Content** | Brand assets, copy, messages | 2 conflicts; 15-locale files untouched, UI hard-coded English | Missing: starter and app strings share files |
| **Docs** | Agent and human guidance | 4 conflicts in `AGENTS.md`, `CLAUDE.md`, `README.md`, a doc | Missing: the app must edit starter docs to add its own |
| **Change intake** | Taking one starter fix early; sending one fix back | 8 conflicts from one hand-port | Missing entirely |

Seams are cheap compared with tooling, and each one removes a whole class of conflict for every future app. **This is the main shift from v1.**

## The evidence program

v1's plan was to create evidence with synthetic agent-built apps. Real apps now exist, and more are coming. Both kinds are useful, for different things:

- **Real apps** show what people actually need and do. They can't be controlled or repeated.
- **Synthetic apps plus planted releases** can be repeated on every release. They only show what we thought to test.

Every real app gets the same study, so results can be compared:

1. Record the fork point (exact starter commit) and the app's purpose.
2. Classify the app's diff against the fork point: product code, seams used, starter files edited, and why.
3. Trial-merge current starter `main` in a throwaway clone; classify each conflict by cause.
4. Scan for silent breaks: removed or renamed env vars still read by app code, security-relevant conflicts where "take upstream" would revert an app fix, starter APIs the app calls that changed.
5. Write lessons with a confidence label, and add a row to the evidence log.

### Evidence log

| App | Built by | Fork point | Days behind | Conflicts | Silent breaks | Top causes | Case study |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lifeor2-client | Agent, no special instructions | `e52e892` (2026-09-16) | 9 (47 commits) | 28 | 2 | Values (9), hand-ported fix (8), dependencies (4), docs (4) | [link](case-study-lifeor2-client.md) |

Conflict causes, totalled across apps (this becomes the real heat map as apps are added):

| Cause | lifeor2-client | Total |
| --- | --- | --- |
| Missing value seam (config) | 9 | 9 |
| Hand-ported upstream fix | 8 | 8 |
| Dependencies and lockfile | 4 | 4 |
| Starter docs edited in place | 4 | 4 |
| Branding and copy in starter files | 2 | 2 |
| Generated code | 1 | 1 |

**Things to watch for in the next apps**, because one app can't tell us:

- Is the cookie/port collision common (developers running several projects locally) or specific to an app that runs beside its own backend?
- Do human-built apps edit the sample and shell more, or less, than agents do?
- Does anyone keep the landing app, or is it always replaced?
- Do apps delete starter features, or switch them off, when a switch exists?
- How far behind do apps drift before their first upgrade?

## Topics, revisited

Each topic shows its **v2 status** (confirmed, changed or new), the evidence, and what to do. Topics without new evidence are kept short; v1 has their full argument.

### 1. Ownership boundaries — confirmed

**Status.** v1's three states hold. The evidence adds that most shared-and-edited code comes from missing seams (see above), not from deliberate choices.

**Evidence.** The admin app was touched only through shared auth plumbing and ports (**seen once**), which supports "consumed". Starter docs turned out to be a shared-and-edited area v1 didn't list (**expected generally**).

**Updated map:**

| Area | State | Change from v1 |
| --- | --- | --- |
| `packages/auth`, `edge-rate-limit`, `ops`, backend platform functions | Consumed | Needs value seams (cookie prefix) before it can really be consumed |
| Design-system primitives and tokens | Consumed, restyled by tokens | Confirmed by lifeor2-client |
| Admin app | Consumed (decided) | Confirmed |
| CI/CD workflows | Consumed, as reusable workflows | Unchanged |
| Landing apps, web dashboard, sample domain | Owned from day one | Unchanged; see topic 2 on removal |
| Web auth pages and settings | Shared-and-edited (for now) | Sign-in page was edited only for branding: a content seam fixes that |
| `schema.ts`, `http.ts`, root `package.json`, `turbo.json` | Shared-and-edited, with registry seams | Schema and routes merged cleanly thanks to spread/route seams |
| **Root agent and project docs** | **Should be layered: starter content in files the app never edits** | **New** |
| **Dev scripts** | **Consumed tooling** | **New: 5 conflicts came from them** |

### 2. Day one: rename, rebrand, remove what you don't use — sharpened

**Status.** v1 predicted "delete the sample" as the first act. The evidence is more subtle: **nobody deleted anything** (**seen once**). The agent swapped one line to render its own workspace and left the sample domain, landing, demo and storybook in place as dead code. The PRD even said "preserve their source initially; decide pruning during implementation". That never happened.

**Why it matters.** Unused code keeps pulling upstream churn. This one upgrade brings 29 demo files, 45 `infra/aws` files and 33 `packages/ops` files the app doesn't use (**expected generally**).

**What to do.** Make removal cheap and obviously safe, so it actually happens:

- The sample lives in its own folders, schema fragment and message file, and the shell renders with zero sample code (v1).
- **Unused apps can be dropped** (landing, landing-static, demo, storybook) by one documented operation, and the upgrade path knows they were dropped.
- CI proves both: the starter builds and passes contracts with the sample and optional apps removed.

### 3. Apps that look nothing like the starter — confirmed

**Status.** lifeor2-client replaced the dashboard with a full-screen conversational workspace and no sidebar, while reusing design-system components and tokens (88 token references in its own CSS). That is exactly the "restyle, don't rewrite" split v1 proposed (**seen once**).

**What to do.** Unchanged. Headless logic only for auth flows (decided); everything else is sample UI.

### 4. Behaviour contracts — elevated

**Status.** v1 called this the strongest idea. The evidence makes it the most urgent, because the two worst outcomes of the trial upgrade merge cleanly (**expected generally**):

1. **Env rename.** App code reads `NEXT_PUBLIC_CONVEX_SITE_URL` and `NEXT_PUBLIC_SITE_URL`, which the starter stopped providing. Clean merge, broken or environment-pinned at runtime.
2. **Reverted security fix.** Resolving the `clear-session` conflict with "take upstream" silently undoes the app's cookie isolation.

**Changed.** Contracts come from two sides:

- **Starter contracts** the app must keep green: auth, endpoint authorization (PR #150), headers, rate limits, required env.
- **App contracts** the upgrade must not break: lifeor2-client already has `lifeor-session-isolation.spec.ts`. The upgrade process must run them and treat them with the same weight as the starter's.

**Also new.** A cheap static check catches silent break #1 without running anything: list env vars the target release removed or renamed, and search app code for them. That belongs in the planner (topic 13).

### 5. Distribution and the consumed-code channel — unchanged, still open

**Status.** No new evidence on registry vs git; lifeor2-client uses plain git with an `upstream` remote, as v1 assumed for the default.

**One new angle.** The hand-port (topic 15) shows apps want changes at **finer granularity than a release**. Whatever channel carries consumed code should make "take version x.y.z of one package" trivial. That favours versioned units (packages or components) over one monolithic merge.

The v1 comparison of four options (git merge only, git dependencies, private registry, vendored snapshot) and the one-day experiment still stand. See [v1, topic 5](brainstorm-v1.md#5-distribution-how-a-change-travels).

### 6. Starter identity — confirmed

**Status.** The agent invented it on its own: the PRD records the exact starter commit, the old README was kept as `README.starter.md`, and the repo keeps an `upstream` remote (**seen once**, but a strong signal that it's natural).

**What to do.** Standardize it, so every app records the same thing in the same place: version, base commit, and consumed-unit versions. Plus (new, from topic 15) **which upstream changes were taken early**.

### 7. Configuration surface (was: branding) — widened

**Status.** v1 was too narrow. Branding is one case of a general need: **values an app will change must be inputs, never literals repeated across files.**

**Evidence (expected generally for most rows):**

| Value | What lifeor2-client had to do | Files touched |
| --- | --- | --- |
| Auth cookie prefix | Thread a new constant through 4 workspaces | 9 |
| Ports (web, admin) | Edit package scripts, Playwright configs, CI env, env examples | 7 |
| Product name and metadata | Hard-code "LifeOR2" in the sign-in page and root layout | 2 |
| Landing URL | Remove the required-env check from the sign-in page | 1 |
| Environment banner | Delete it from the root layout | 1 |

**What to do.** One app-owned configuration module, read by starter code:

- **Identity:** product name, legal entity, support email, URLs.
- **Runtime:** ports, cookie prefix, origins.
- **Brand:** logos, token overrides, email palette and footer (v1).
- **Switches:** optional platform features and chrome (waitlist, invitations, env banner).

**Rule for the starter:** a value an app is likely to change appears in exactly one place, and that place is the app's.

### 8. Localization — enforcement added

**Status.** v1's namespace split stands. The evidence adds two things:

- **An unguided agent bypassed i18n entirely.** All new UI is English literals; the message files were never touched (**seen once**, but likely for agents without instructions).
- **The app is effectively single-locale.** That supports v1's "locale subset" idea: the app picks its locales, and the starter keeps translating its own keys into all 15.

**What to do.** Beyond the split: first-contact instructions (topic 17) must say how to add strings, and a lint should flag untranslated JSX text in apps that ship more than one locale. For single-locale apps, literal text is fine; the lint should respect the app's locale choice.

### 9. Dependencies — confirmed

**Status.** Independent drift started immediately: own Renovate, 7 new runtime dependencies, own pins (**expected generally**). The trial merge conflicted on `bun.lock` (21 hunks), both `package.json` files and `renovate.json`.

**What to do.** Unchanged from v1 (publish floors, not pins; report, don't resolve). Two additions:

- **Never merge the lockfile.** Take either side, then regenerate. Say so in the upgrade guide.
- **Renovate config should be layered** like docs: starter rules in a preset the app extends, not a file both sides edit.

### 10. Data, config and deploy — confirmed, with a concrete example

**Status.** The starter's `NEXT_PUBLIC_*` to unprefixed env rename (for build-once/promote) is exactly the kind of change v1 said the brief ignored. It touched `auth/server.ts`, CI workflows, env examples and Playwright configs, and silently broke app code (topic 4).

**What to do.** Unchanged from v1 (expand/contract schemas, migration status checks, declared env), plus: **every release lists breaking changes as data**: renamed or removed env vars, renamed exports, removed files. Tools and agents can then check for them.

### 11. Recording divergence — changed focus

**Status.** v1 worried about recording what apps *removed*. The evidence says the more useful record is what apps **took early or changed on purpose in starter code**, because that's what an upgrade must reconcile (**seen once**).

**What to do.** Keep "disable, don't delete" (v1). Replace the idea of a divergence ledger with two small records in the identity file: changes taken early from upstream (topic 15) and deliberate edits to starter code offered back upstream (topic 16).

### 12. Agents as builders and upgraders — changed

**Status.** lifeor2-client is **real evidence of how an unguided agent uses the starter**, which v1 could only plan to simulate. What it shows (**seen once**):

- **Good by default:** namespaced product code, used existing seams, reused the design system, recorded provenance, wrote its own security tests.
- **Bad by default:** skipped i18n, hard-coded branding, edited starter platform code for missing config, hand-ported an unreleased fix in a language the starter forbids.

**Changed.** The synthetic benchmark is still worth building, but it's no longer the only evidence source. Two changes:

1. **Upgrade lifeor2-client for real** as the first benchmark run. Record time, human interventions, and what the contracts caught.
2. **Test first contact, not just upgrades.** Give agents the same "build on the starter" instruction with and without the starter's first-contact guidance (topic 17). Compare how many seams they use and how many starter files they edit.

Unattended upgrade policy: decided (see decisions table).

### 13. Upgrade planner — confirmed, with a sharper spec

**Status.** The trial merge is what the planner should automate. Its useful output, based on this case:

- Changed starter files the app also changed, with the likely cause (value, content, docs, hand-port).
- **Env vars removed or renamed in the target release that app code still reads.** This one check catches silent break #1.
- **Conflicts in security-relevant files where the app's side is a fix.** These must not be resolved with "take upstream".
- Upstream changes the app already took early (topic 15), so they're resolved in the app's favour.
- Lockfile handling: regenerate, never merge.

No merge engine: still parked.

### 14. Feature delivery into owned apps — unchanged, untested

**Status.** lifeor2-client didn't take any new starter feature, so there's no evidence yet. v1's four-part design (platform, add-on UI, wiring recipe, switch) stands. See [v1, topic 14](brainstorm-v1.md#14-how-new-features-reach-an-app-that-owns-its-ui).

### 15. Taking one upstream fix early — new

**Evidence.** The app needed the starter's process-isolation fix (PR #97) before it was released. The agent re-implemented it by hand, in Python. Upstream later shipped its own TypeScript version, and the two collide in 8 files (**seen once**; the need is **expected generally**: security fixes especially can't wait for a release).

**Idea.** A supported "take this change" path:

- Starter changes are small, self-contained PRs with a stable ID.
- The app takes one by cherry-picking the upstream commit (not re-implementing it) and records the ID in its identity file.
- On the next upgrade, the planner sees the ID and resolves those files in upstream's favour, because the app already has the same change.

**Against.** Cherry-picks of changes that depend on other unreleased changes don't apply cleanly. Frequent small releases reduce the need, and may be the simpler answer.

**What to do.** Both: release more often (the starter moved 47 commits in 9 days), and document the cherry-pick-and-record path for the cases that can't wait.

### 16. Changes flowing back upstream — new

**Evidence.** lifeor2-client improved the starter in three places: a cookie-prefix option, dev-only guards on mock email and dev seed, and exact cookie matching instead of a loose `endsWith` (**seen once**). The last one is a genuine bug fix.

**Idea.** The relationship is two-way. An app should be able to mark an edit to starter code as "offered upstream", and the starter should have a light intake: review, generalize, release. Once released, the app's next upgrade takes the upstream version and its own edit disappears.

**Against.** Buyer apps may be private and licensed code; contributions raise ownership and licensing questions. Many app edits are too specific to generalize.

**What to do.** Start with this one app: upstream the three changes. That also removes their conflicts. Decide the policy for buyers later (open question).

### 17. First contact: what happens when someone says "build on the starter" — new

**Evidence.** The agent's only instruction was "build the app based on the web-app-starter". Everything it did (good and bad) came from what it found in the repo on first read. It inherited the starter's `CLAUDE.md` wholesale and prefixed it with "conventions below are inherited … upstream trackers are historical" (**seen once**). The starter's guidance was written for developing the starter, not for building an app on it.

**Idea.** The starter needs an explicit **first-contact path**, for humans and agents:

- A short "building an app on this starter" guide, read first: where product code goes, which seams exist, what to remove, how to add strings and branding, what never to edit.
- **Layered agent docs:** starter guidance in files the app never edits (for example `docs/starter/AGENTS.md`); the app's own root `AGENTS.md` / `CLAUDE.md` imports them and adds its own rules.
- Optionally, an **init step** that performs day-one operations: writes the identity file, sets name and ports in the configuration module, removes the sample and unused apps on request, and sets up the layered docs.

**Against.** An init step is one more thing to maintain and test. A clear guide may be enough for agents, which read instructions reliably.

**What to do.** Write the guide and layer the docs first (cheap, **expected generally** to help). Test an init step later using the first-contact experiment in topic 12.

## Explorations, clustered by actionability

The seventeen topics collapse into nine explorations. v1's structure holds; the changes are an **upstream-now** exploration, a **first contact** exploration, the evidence engine rebuilt around real apps, and a widened day-one exploration.

| Exploration | Topics | Actionability | First concrete step | Done when | Change from v1 |
| --- | --- | --- | --- | --- | --- |
| **0. Upstream lifeor2's improvements** | 16 | Do now: a few hours | Add a cookie-prefix option to `@repo/auth`; port the `developmentOnly` guards; fix `hasSessionCookie` matching | Released upstream; lifeor2-client's next upgrade drops its own versions | New |
| **A. Make day one free** | 2, 6, 7, 8, 11 | Do now: days | Configuration module (name, ports, cookie prefix, brand); identity file; isolate the sample | A fresh app can set its values, drop the sample and unused apps, and take the next release with zero conflicts from those changes | Widened from branding to configuration; adds dropping unused apps |
| **B. Prove it still works** | 4, 10 | Build next: weeks | Session/cookie contract (would have caught the `clear-session` revert); land PR #150 | One command runs starter contracts **and the app's own contracts**, plus env checks | Adds app contracts |
| **C. Tell me why and what** | 9, 10, 13 | Build next | Release notes list breaking changes as data (renamed env, removed files) | The planner reports overlaps, removed env still read by app code, security-file conflicts and early-taken changes | Sharper planner spec from the trial merge |
| **I. First contact** | 12, 17 | Do now (guide), then experiment | Write "building an app on this starter"; move starter agent guidance into files apps never edit | Two agents given the same brief, one with the guide, show fewer starter-file edits | New |
| **J. Two-way change flow** | 15, 16 | Design next | Document cherry-pick-and-record for early fixes; release more often | An early-taken fix causes zero conflicts on the next upgrade | New |
| **D. Feature delivery into owned apps** | 3, 14 | Design next: pilot one feature | Take the next roadmap feature through all four parts | An app that removed the sample can switch it on, pull its UI and pass its contracts | Unchanged |
| **E. Choose the consumed-code channel** | 5 | Experiment: about one day | Push `edge-rate-limit` through each viable channel | Each option scored on install, offline CI, Renovate, emergency patch, revoked licence | Unchanged |
| **F. Evidence program** | 12 | Ongoing | Upgrade lifeor2-client for real as run #1; study each new app with the same method | The evidence log has 3+ apps; the cause totals point at the next seam to build | Rebuilt around real apps; synthetic benchmark becomes a complement |
| **G. Shrink the shared surface** | 1, 3, 10 | Architecture bets: decide from F and E | Spike one: backend platform as a Convex component, or headless auth flows | The top cause in the evidence log becomes consumed or owned | Now decided from real-app data |
| **H. Parked** | 9, 11, 13 | Not now | None | Revisit if F shows failures these would have prevented | Unchanged: semantic merge engine, full ownership manifest, dependency resolver, hand-kept divergence ledger |

**Order.** 0 first: it's a few hours and removes conflicts from the only real app. A and I in parallel next: they're the seams and the guide that make the next app better than this one. B and C follow, then J. F runs throughout, and its log decides G. D waits for a real feature to pilot; E can run any time.

## Open questions

Still open from v1:

1. **Registry or not for consumed code?** Explore with the one-day experiment (exploration E).

New from the evidence:

2. **Is local coexistence a supported scenario?** Running the app beside other local projects (ports, cookies) broke 16 files here. If it's common, the configuration module must cover it from day one.
3. **Do buyers contribute back?** lifeor2-client improved the starter. Should there be a contribution path for buyer apps, and what does the licence say about it?
4. **How often should the starter release?** 47 commits and a breaking env rename in 9 days pushed a 9-day-old app to 28 conflicts. Smaller, more frequent releases, each with a breaking-changes list, would make each upgrade smaller.
5. **Guide or init step for first contact?** A written guide is cheap; an init step is more reliable but has to be maintained. The first-contact experiment should decide.
6. **Which locales does a new app get by default?** lifeor2-client is effectively English-only. Should apps start with one locale and opt into more, or start with all 15?
