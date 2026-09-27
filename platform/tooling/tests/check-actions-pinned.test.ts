import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { main, unpinnedUses } from "../check-actions-pinned.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("accepts SHA pins, local actions and reusable workflows", () => {
  assert.deepEqual(unpinnedUses([
    "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "        uses: github/codeql-action/init@b96794f015dfd88f77b49b1c93e0fa7110f94c63 # v4.38.0",
    "      - uses: ./.github/actions/setup-bun",
    "    uses: ./.github/workflows/platform-ci-web.yml",
  ].join("\n")), []);
});

test("rejects tags, branches and short SHAs", () => {
  assert.deepEqual(unpinnedUses([
    "      - uses: actions/checkout@v4",
    "        uses: 'oven-sh/setup-bun@main'",
    "      - uses: foo/bar@3d3c42e",
  ].join("\n")).map((u) => u.uses), ["actions/checkout@v4", "oven-sh/setup-bun@main", "foo/bar@3d3c42e"]);
});

test("this repository's workflows and actions are pinned", () => {
  const lines: string[] = [];
  assert.equal(main([repoRoot], (line) => lines.push(line)), 0, lines.join("\n"));
});
