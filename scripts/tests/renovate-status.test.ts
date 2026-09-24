import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDashboard, parseHolds } from "../renovate-status.ts";

test("parses dashboard sections, strips markers, and skips detected dependencies", () => {
  const body = [
    "This issue lists Renovate updates.",
    "## Pending Approval",
    " - [ ] <!-- approve-branch=renovate/major-x -->chore(deps): update x to v2",
    " - [ ] <!-- approve-all-pending-prs -->🔐 **Create all pending approval PRs at once** 🔐",
    "## Pending Status Checks",
    " - [ ] <!-- unpend-branch=renovate/y -->chore(deps): update y",
    "## Repository Problems",
    " - ⚠️ WARN: Could not re-extract the packageFile after updating it",
    "## Detected Dependencies",
    " - `react 19.3.0`",
  ].join("\n");
  assert.deepEqual(parseDashboard(body), {
    "Pending Approval": ["chore(deps): update x to v2"],
    "Pending Status Checks": ["chore(deps): update y"],
    "Repository Problems": ["⚠️ WARN: Could not re-extract the packageFile after updating it"],
  });
});

test("extracts HOLD rules and the packages their REMOVE condition names", () => {
  const holds = parseHolds({
    packageRules: [
      { description: "Auto-merge non-major updates", matchPackageNames: ["*"] },
      { description: "HOLD: needs peer. REMOVE when `bun info eslint-plugin-react@latest peerDependencies` accepts 10.",
        matchPackageNames: ["eslint"], allowedVersions: "<10" },
      { description: "HOLD: scoped. REMOVE when `bun info @typescript-eslint/parser@latest peerDependencies` allows it.",
        matchPackageNames: ["typescript"], allowedVersions: "<7" },
    ],
  });
  assert.deepEqual(holds.map((h) => [h.packages, h.allowedVersions, h.peerChecks]), [
    [["eslint"], "<10", ["eslint-plugin-react"]],
    [["typescript"], "<7", ["@typescript-eslint/parser"]],
  ]);
});
