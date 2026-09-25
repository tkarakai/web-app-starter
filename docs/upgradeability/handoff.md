# Web Application Starter Kit → Downstream Business App Upgrade Strategy
## Engineering / AI-Agent Handoff

**Status:** Working design brief  
**Purpose:** Turn the current starter-kit ideas into an upgradeable architecture, a repeatable downstream upgrade process, and instructions/tooling that can be safely used by either humans or AI agents.

---

## 1. Context

We maintain a **web application starter kit** that is cloned or otherwise used as the baseline for downstream applications.

The starter provides generally useful SaaS/application capabilities such as:

- Authentication and account-related primitives
- Landing-page / entry flows
- Sign-up and waitlist capabilities
- Common application shell patterns
- Sidebar, menus, dialogs, buttons, and other professional application UI primitives
- Shared infrastructure and dependencies

After a downstream business application is created, the two codebases begin to evolve independently:

1. The **starter** receives security patches, dependency updates, bug fixes, and functional improvements.
2. The **business application** develops its own domain-specific functionality, branding, layout, dependencies, and customizations.

The core problem is:

> **How should a downstream application evolve so that it can selectively and safely consume future starter-kit improvements without repeatedly performing a difficult manual merge?**

This document captures the current ideas and turns them into an actionable design direction.

---

## 2. Desired Outcome

The starter should be designed not only as something that is easy to clone, but as something that remains **upgradeable after cloning**.

A successful design should make it possible to:

- Clearly distinguish starter-owned code from business-app-owned code.
- Minimize unnecessary overlap between those areas.
- Detect when downstream changes have modified starter assumptions.
- Bring security and functional starter updates into downstream applications safely.
- Reconcile dependency changes between the starter and the business application.
- Preserve business-specific branding, strings, layout, and functionality.
- Allow downstream applications to diverge substantially from the starter's default UI.
- Give AI agents enough structure to perform or assist with upgrades safely.
- Validate the result automatically after an upgrade.

The ideal result is closer to a **managed upgrade path** than a raw Git merge.

---

# 3. Core Design Principle: Create Separation Before the Clone

A major idea is to prepare the starter itself so that the future business application already has a clearly defined place to grow.

Instead of waiting for every downstream application to invent its own separation strategy, the starter should establish the separation up front.

Conceptually:

```text
application/
├── starter-owned-or-shared/
├── business-app-owned/
├── configuration/
├── branding/
├── localization/
└── tooling/
```

The exact directory names are not important yet. The important principle is:

> **The starter should deliberately leave an obvious extension space for the downstream application.**

This means the starter development team should think about what can be treated as stable starter infrastructure and what is explicitly intended to be replaced, extended, or owned by a business application.

### Questions to resolve

- Which files remain starter-owned?
- Which files are expected to be customized downstream?
- Which files are extension points?
- Which files may be overridden but should not normally be edited directly?
- Which areas should be considered protected?
- Which areas should downstream applications be free to redesign completely?

The answer should eventually be encoded in both documentation and machine-readable metadata.

---

# 4. Do Not Assume the Downstream App Looks Like the Starter

The starter currently resembles a conventional professional business/SaaS application with features such as a sidebar, menus, dialogs, and buttons.

However, the downstream product may not use that structure at all.

Examples:

- A highly customized workflow application
- A mobile-first experience
- A game-like interface
- A full-screen interactive product
- A product with no sidebar
- A product whose authenticated experience is structurally unrelated to the starter UI

Therefore, the architecture should separate:

### Broadly reusable platform capabilities

Examples:

- Authentication
- User/session handling
- Database infrastructure
- Registration/sign-up flows
- Waitlist capabilities
- Shared security controls
- Common APIs or services
- Build/deployment conventions
- Cross-cutting utilities

from:

### Starter-specific presentation choices

Examples:

- Sidebar layout
- Default navigation
- Dashboard structure
- Page composition
- Menu organization
- Visual hierarchy
- Default workflow

The second category should not become an accidental upgrade constraint.

---

# 5. Use AI Agents as Architecture Stress Tests

One proposed experiment is to deliberately give AI coding agents the starter and ask them to create a variety of applications on top of it.

The point is not primarily to keep the applications they create.

The point is to **observe how the starter is used, modified, bypassed, or fought against**.

## Suggested experiment

Give multiple agents tasks such as:

- Build a conventional business dashboard.
- Build a mobile-first SaaS product.
- Build an application with a radically different layout.
- Build a game-like authenticated experience.
- Build a workflow-heavy enterprise application.
- Build an application that heavily customizes branding.
- Build an application with substantial localization requirements.

Then analyze:

- Which starter files did the agents edit?
- Which files did they replace entirely?
- Which files caused friction?
- Which primitives remained useful across all applications?
- Which directories naturally became "business app" territory?
- Which starter assumptions turned out to be too rigid?
- Which modifications would make future starter upgrades difficult?
- What boundaries would have prevented those difficulties?

The output of this exercise should be used to define the starter's supported extension model.

---

# 6. Introduce Explicit Ownership and Protected Boundaries

The project should consider defining categories of files or directories.

A possible model:

| Category | Meaning |
|---|---|
| **Starter Core** | Expected to remain compatible with future starter upgrades. Direct downstream modification should be discouraged. |
| **Extension Point** | Designed to be implemented or overridden by the business app. |
| **Business-Owned** | Downstream application code. Starter upgrades should not overwrite it. |
| **Generated** | Produced by tooling; should not be hand-maintained. |
| **Configuration** | Supported values that intentionally alter starter behavior. |
| **Replaceable UI** | Default starter UI that may be completely replaced downstream. |

These classifications should eventually be machine-readable.

For example, the starter could contain a manifest conceptually similar to:

```yaml
starter:
  version: 3.4.0

ownership:
  starter_core:
    - src/platform/**
    - src/auth/**

  extension_points:
    - src/app/**
    - src/integrations/**

  business_owned:
    - src/business/**

  generated:
    - generated/**
```

This is illustrative only. The actual format should fit the technology stack.

The important idea is that an upgrade agent should not have to infer ownership solely from Git history.

---

# 7. Build Upgrade and Validation Tooling Into the Starter

A major recurring concept is that the starter should ship with tooling that helps downstream applications validate and upgrade themselves.

The tooling should evolve with the starter.

## Important principle

> **Upgrade the upgrade tooling first.**

A downstream app attempting to move from starter version A to starter version B should first obtain the latest compatible upgrade/validation tooling.

That tooling can then understand both:

- the downstream application's current state, and
- the incoming starter version.

## Potential tooling responsibilities

### Validation

Check whether critical starter functionality is still intact.

Examples:

- Authentication contract
- Session behavior
- Required configuration
- Security headers
- Required middleware
- Database assumptions
- API contracts
- Build configuration
- Known starter invariants

### Ownership inspection

Identify:

- Starter files changed downstream
- Protected files modified
- Expected extension points used incorrectly
- Starter code copied into business-owned areas
- Business logic placed inside starter-core areas

### Upgrade planning

Generate a report such as:

```text
SAFE TO APPLY
- 18 starter files unchanged downstream
- 7 dependency updates
- 3 new starter files

REVIEW REQUIRED
- auth/session.ts modified downstream
- navigation component replaced
- localization base file modified

CONFLICT
- library X:
    starter target: 5.1
    business app: 6.0
```

### Automated migration

Where possible:

- Apply known migrations
- Run codemods
- Move files to new locations
- Update configuration formats
- Add new required files
- Update dependency ranges
- Rewrite imports

### Post-upgrade verification

Run:

- Unit tests
- Integration tests
- Starter compatibility checks
- Security checks
- Type checks
- Build checks
- Dependency checks
- Migration verification

---

# 8. Treat the Starter as a Versioned Contract

The starter should eventually have an explicit version identity that survives cloning.

For example, the downstream application should be able to answer:

```text
Current application starter baseline: 3.2.1
Latest compatible starter baseline: 3.5.0
```

This could be recorded in a metadata file rather than inferred from Git ancestry.

Possible metadata:

```yaml
starter:
  id: company-webapp-starter
  baseline_version: 3.2.1
  last_upgrade: 2026-09-01
```

This creates an important concept:

> A business application is not simply "a fork from some old commit." It is "an application based on starter contract version X."

That gives both humans and agents a much clearer upgrade model.

---

# 9. Branding Guidance

Branding should be treated as a supported customization surface rather than an ad-hoc set of edits.

The starter should document where downstream branding belongs.

Potential branding areas include:

- Logos
- Favicon/app icons
- Product name
- Company name
- Colors/theme tokens
- Typography
- Images and illustrations
- Email branding
- Metadata
- Browser titles
- Social-preview metadata
- Default copy
- Legal/footer content
- Login/sign-up visual treatment

## Goal

A downstream team or AI agent should be able to answer:

> "Where do I put the business application's branding without modifying starter-core implementation?"

Ideally, starter updates should not overwrite branding.

A future enhancement could be a central branding configuration or theme contract rather than requiring edits across many unrelated source files.

---

# 10. Internationalization / I18N Strategy

Localization is another area where starter and downstream ownership can easily collide.

The design should answer questions such as:

- Where do starter-provided strings live?
- Where do business-specific strings live?
- Can a business application override starter strings?
- Should downstream strings be stored in separate files?
- What happens when the starter introduces a new key?
- What happens when the starter renames or removes a key?
- How are translation completeness and stale translations detected?

## Preferred conceptual separation

Instead of requiring downstream applications to edit the starter's translation files directly, consider separate namespaces.

Example:

```text
locales/
├── starter/
│   ├── en.json
│   ├── de.json
│   └── ...
└── business/
    ├── en.json
    ├── de.json
    └── ...
```

Or equivalent namespacing inside the chosen localization framework.

An override layer may also be useful:

```text
starter defaults
      ↓
business overrides
      ↓
runtime strings
```

This is preferable to creating perpetual merge conflicts inside shared JSON files.

## Tooling opportunities

The upgrade tooling could detect:

- Starter translation keys added
- Starter translation keys removed
- Downstream overrides targeting removed keys
- Missing translations
- Duplicate keys
- Namespace collisions
- Deprecated strings

---

# 11. Dependency Management and Reconciliation

Dependency management is one of the harder upgrade problems.

Both the starter and the business application may independently keep dependencies current.

For example:

```text
Starter originally used Library X 3.x

Later:
Starter upgrades Library X → 4.x
Business app independently upgrades Library X → 5.x
```

When a later starter upgrade occurs, blindly applying the starter dependency manifest may actually **downgrade** the business app or introduce incompatible assumptions.

Therefore, dependency updates should not be treated as ordinary text-file merges.

## Desired strategy

Create tooling that understands dependency intent.

For every overlapping dependency, determine:

- Current downstream version
- Old starter version
- New starter version
- Whether the downstream version already satisfies the new starter requirement
- Whether the starter relies on APIs that changed between versions
- Whether an incoming version represents a security requirement
- Whether a migration is needed
- Whether the business application has introduced related plugins or peer dependencies

## Example result

```text
react
  downstream: 20.0
  incoming starter: 19.2
  action: KEEP DOWNSTREAM VERSION
  validation: run starter compatibility suite

auth-library
  downstream: 4.1
  incoming starter: 5.0
  action: UPGRADE
  reason: starter now depends on v5 API
  migration: available

date-library
  downstream: 2.3
  incoming starter: 3.0
  action: MANUAL REVIEW
  reason: downstream contains direct API usage
```

The tool should reconcile dependencies based on compatibility, not simply prefer one manifest over the other.

---

# 12. Recommended Upgrade Model

A future downstream upgrade process could look like this:

## Phase 1 — Identify state

Determine:

- Current starter baseline version
- Target starter version
- Downstream modifications to starter-owned areas
- Business-owned areas
- Current dependency state
- Current localization state
- Current branding configuration

## Phase 2 — Update upgrade tooling

Bring in the newest upgrade/validation tooling that understands the migration path.

## Phase 3 — Analyze before changing

Produce a machine-readable and human-readable upgrade plan.

Classify changes into:

- Automatic
- Safe but requires validation
- Conflict
- Human/agent judgment required

## Phase 4 — Apply starter changes

Apply the parts of the starter upgrade that are appropriate for this downstream application.

Do **not** blindly overwrite business-owned areas.

## Phase 5 — Reconcile

Reconcile:

- Starter-core changes
- Downstream modifications
- Dependencies
- Configuration
- Branding
- Localization
- UI replacements
- APIs/contracts

## Phase 6 — Validate

Run:

- Starter integrity checks
- Business application tests
- Build/type checks
- Security checks
- Dependency validation
- Localization validation

## Phase 7 — Produce an upgrade report

Record:

- Previous starter version
- New starter version
- Automated changes
- Manual changes
- Conflicts resolved
- Dependencies changed
- Validation results
- Remaining exceptions

That report becomes useful context for future upgrades.

---

# 13. AI-Agent-First Upgrade Design

Because implementation and future upgrades may increasingly be handled by AI coding agents, the project should be intentionally designed so agents can operate with less ambiguity.

The starter should provide agents with explicit instructions rather than relying on tribal knowledge.

## Agents need to know

- What the starter owns
- What the business application owns
- Which files should normally not be modified
- Which extension points are supported
- Which starter features are optional
- Which starter invariants must remain true
- How branding is customized
- How localization is extended
- How dependencies are reconciled
- How an upgrade is performed
- Which tests prove the upgrade was successful
- When an agent must stop and ask for human review

---

# 14. Suggested AI Agent Contract

The repository may eventually include a dedicated agent instruction file such as:

```text
AGENTS.md
UPGRADE.md
starter-manifest.yaml
```

The exact filenames are not important yet.

A future upgrade agent should conceptually follow instructions such as:

```text
1. Read the starter manifest and current baseline version.

2. Do not modify business-owned directories unless required by a
   documented migration.

3. Do not overwrite branding, localization overrides, or business
   configuration with starter defaults.

4. Compare the incoming starter version against the current baseline.

5. Inspect all downstream modifications to starter-core files.

6. Generate an upgrade plan before changing files.

7. Reconcile dependencies semantically; do not blindly replace the
   dependency manifest.

8. Apply supported migrations and codemods.

9. Run starter compatibility validation.

10. Run the business application's own validation suite.

11. If a protected starter invariant cannot be preserved automatically,
    stop and surface the conflict explicitly.

12. Produce an upgrade report.
```

This makes the upgrade process much more suitable for autonomous or semi-autonomous agents.

---

# 15. Machine-Readable Concepts to Consider

To make the repository easier for AI agents and tooling to understand, consider eventually introducing some combination of:

- Starter version manifest
- Ownership/path manifest
- Protected-file list
- Extension-point registry
- Feature/capability registry
- Upgrade migration definitions
- Compatibility test suite
- Dependency constraints
- Deprecation metadata
- Localization namespaces
- Branding configuration schema
- Structured upgrade reports

The philosophy is:

> **If an important rule only exists in somebody's head or in prose documentation, an automated agent is more likely to violate it.**

Important upgrade rules should therefore be both documented and machine-detectable where practical.

---

# 16. Avoid Over-Protecting the Starter

There is a tension to manage.

If too much code is declared untouchable, the starter becomes restrictive and downstream teams will simply bypass its rules.

The goal is not:

> "Never change the starter."

The goal is:

> "Make it obvious which changes increase future upgrade cost."

A downstream team should still be free to diverge deliberately.

For example, the system might track:

```text
Starter compatibility exceptions:
- default navigation replaced
- dashboard shell removed
- starter email templates replaced
```

Those are not necessarily errors.

They simply become known divergences that the upgrade system can account for later.

---

# 17. Potential Three-Way Upgrade Model

A useful mental model for future tooling is a semantic three-way comparison:

```text
A = old starter baseline
B = current business application
C = new starter version
```

The upgrade system asks:

> What changed from A → B because of the business application?

and:

> What changed from A → C because of the starter?

Then it attempts to produce:

```text
D = upgraded business application
```

while preserving the intent of both sets of changes.

This resembles a three-way merge, but the long-term opportunity is to make it **more semantic than Git** by understanding:

- Ownership
- Dependencies
- Configuration
- Localization
- Branding
- Known migrations
- Starter invariants

---

# 18. Possible Implementation Workstreams

The ideas above can be explored as several independent workstreams.

## Workstream A — Repository architecture

Define:

- Starter-owned areas
- Business-owned areas
- Extension points
- Replaceable UI areas
- Configuration boundaries

## Workstream B — Starter metadata

Create an initial starter manifest containing:

- Starter ID
- Version
- Ownership rules
- Protected invariants

## Workstream C — Validation tooling

Build a command such as conceptually:

```bash
starter validate
```

that can detect important compatibility issues.

## Workstream D — Upgrade tooling

Prototype:

```bash
starter upgrade --to <version>
```

with a plan-first mode.

## Workstream E — Dependency reconciliation

Build a dependency comparison/reporting prototype.

## Workstream F — Branding contract

Centralize and document supported branding customizations.

## Workstream G — Localization contract

Separate starter and business translation ownership and define overrides.

## Workstream H — Agent instructions

Create explicit repository-level guidance for AI coding/upgrading agents.

## Workstream I — Agent stress testing

Have agents build intentionally different downstream applications and use their behavior to refine the architecture.

---

# 19. Suggested Order of Exploration

A reasonable sequence is:

1. **Map the current starter.**
   Identify platform primitives versus default application/UI choices.

2. **Define ownership boundaries.**
   Decide what should remain starter-owned and where business code should live.

3. **Create the first starter manifest.**
   Encode baseline version and ownership information.

4. **Create validation tooling before upgrade tooling.**
   First prove that the system can determine whether the starter contract is intact.

5. **Run AI-agent stress-test projects.**
   Observe where the architecture works and where agents naturally violate it.

6. **Refine extension points.**

7. **Design branding and localization ownership.**

8. **Prototype dependency reconciliation.**

9. **Build a plan-first upgrade tool.**

10. **Create AI-agent upgrade instructions and structured upgrade reports.**

---

# 20. Key Questions Still to Answer

These are design questions, not blockers to beginning exploration.

### Architecture

- Should starter-core functionality live physically under a dedicated directory?
- Should the business application have its own top-level application directory?
- Which existing files cannot realistically be separated?
- Should downstream apps inherit components, copy components, or wrap components?

### Upgrade mechanism

- Is the starter distributed as Git history, a package, a template release, an artifact, or some combination?
- What is the canonical source for a starter version?
- How are migrations versioned?
- Should upgrades support skipping multiple starter versions?

### Ownership

- Are protected files truly immutable, or simply "high upgrade cost"?
- How should intentional downstream divergence be recorded?

### Dependencies

- Which dependencies are starter infrastructure dependencies?
- Which are entirely downstream-owned?
- How should peer dependencies and framework versions be treated?

### Localization

- Should downstream applications use separate translation namespaces?
- Which starter strings may be overridden?
- Can overrides survive key renames automatically?

### Branding

- Can all normal branding be expressed through configuration/assets?
- Which branding currently requires implementation changes?

### AI agents

- What changes may an agent make autonomously?
- Which conflicts require review?
- What validation is sufficient for an agent to declare an upgrade successful?

---

# 21. Definition of Success

The design is successful when a downstream application can say:

> "We are based on Starter vX. We intentionally own these areas. We intentionally diverged in these places. Starter vY is available. The upgrade tool can show us exactly what will change, preserve our business functionality, reconcile dependencies, run migrations, validate critical starter behavior, and tell us where human or agent judgment is required."

At that point, the starter has evolved from a simple project template into an **upgradeable application foundation**.

---

# 22. Guiding Principle

The recurring idea across all of these notes is:

> **Design the starter, the downstream application, and the upgrade process as a long-lived relationship rather than a one-time clone.**

In the age of AI-assisted development, that relationship should be made explicit enough that both humans and intelligent agents can reason about it safely.

The most valuable ingredients are likely to be:

- clear ownership boundaries,
- versioned contracts,
- machine-readable metadata,
- validation tooling,
- semantic dependency reconciliation,
- explicit customization mechanisms,
- and a plan-first, test-driven upgrade process.

Those capabilities should make future starter improvements substantially easier to adopt without sacrificing downstream application freedom.
