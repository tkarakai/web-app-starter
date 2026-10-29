import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("platform instruction files match the actual Next.js dev generator", t => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  for (const app of ["admin", "storybook"]) {
    const require = createRequire(path.join(root, `platform/apps/${app}/package.json`));
    const generator = require("next/dist/server/lib/generate-agent-files.js") as {
      writeAgentFiles: (dir: string) => unknown; hasCurrentAgentRules: (dir: string) => boolean;
    };
    const temp = mkdtempSync(path.join(tmpdir(), "next-agent-files-"));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    generator.writeAgentFiles(temp);
    const installed = path.join(root, `platform/apps/${app}`);
    assert.equal(readFileSync(path.join(installed, "AGENTS.md"), "utf8"), readFileSync(path.join(temp, "AGENTS.md"), "utf8"), `${app}/AGENTS.md: refresh when upgrading Next.js`);
    // Next.js 16.4 no longer writes CLAUDE.md; ours stays so Claude Code loads the same rules.
    assert.equal(readFileSync(path.join(installed, "CLAUDE.md"), "utf8"), "@AGENTS.md\n", `${app}/CLAUDE.md must import AGENTS.md`);
    assert(generator.hasCurrentAgentRules(installed));
  }
});
