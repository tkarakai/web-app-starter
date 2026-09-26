# Upgradeability working drafts

How downstream business apps keep taking starter fixes, improvements and new features. `repo-separation.md` is the authoritative design and `repo-separation-implementation-plan.md` its plan; the rest is background: the original brief, brainstorms and evidence.

| File | What it is |
| --- | --- |
| [handoff.md](handoff.md) | The original design brief: a mix of developed and undeveloped ideas |
| [brainstorm-v1.md](brainstorm-v1.md) | First brainstorm: the brief argued topic by topic, from the code alone |
| [case-study-lifeor2-client.md](case-study-lifeor2-client.md) | First real app built on the starter, with a trial upgrade merge |
| [repo-separation.md](repo-separation.md) | **Authoritative design:** two repos, the platform zone, instruction layers, Agent Skills, update delivery, CI, releases, and the decisions behind them |
| [repo-separation-implementation-plan.md](repo-separation-implementation-plan.md) | **Plan for the repo separation:** phases and PR-sized tasks with acceptance checks, from preparation to release v2.0.0 and re-baselining lifeor2-client |
| [brainstorm-v2.md](brainstorm-v2.md) | Second brainstorm, revised with the case study; background for the design |

Earlier upgrade work lives in `docs/starter-upgrades.md` and `docs/starter-versioning-strategy.md`; these drafts were written independently of it.
