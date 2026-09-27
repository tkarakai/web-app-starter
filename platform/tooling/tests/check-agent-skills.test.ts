import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkAgentSkills, parseFrontmatter } from "../check-agent-skills.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function skill(name: string, description = "Use to do the thing."): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSteps.\n`;
}

function fixture(skills: Record<string, string>, links: Record<string, string> = {}, linkAll = true): string {
  const root = mkdtempSync(path.join(tmpdir(), "agent-skills-"));
  for (const [name, text] of Object.entries(skills)) {
    mkdirSync(path.join(root, "platform/agent-skills", name), { recursive: true });
    writeFileSync(path.join(root, "platform/agent-skills", name, "SKILL.md"), text);
  }
  for (const dir of [".claude/skills", ".agents/skills"]) {
    mkdirSync(path.join(root, dir), { recursive: true });
    if (linkAll) {
      for (const name of Object.keys(skills)) {
        symlinkSync(`../../platform/agent-skills/${name}`, path.join(root, dir, name));
      }
    }
    for (const [name, target] of Object.entries(links)) symlinkSync(target, path.join(root, dir, name));
  }
  return root;
}

function check(root: string): string[] {
  try {
    return checkAgentSkills(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the repository's platform skills and links are consistent", () => {
  assert.deepEqual(checkAgentSkills(repoRoot), []);
});

test("a linked skill with matching frontmatter passes", () => {
  assert.deepEqual(check(fixture({ "platform-demo": skill("platform-demo") })), []);
});

test("a frontmatter name that differs from the folder fails", () => {
  const errors = check(fixture({ "platform-demo": skill("platform-other") }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /name is "platform-other", expected "platform-demo"/);
});

test("a skill folder without the platform- prefix fails", () => {
  const errors = check(fixture({ demo: skill("demo") }));
  assert.ok(errors.some((e) => e.includes('must start with "platform-"')));
});

test("missing description and missing instructions fail", () => {
  assert.ok(check(fixture({ "platform-demo": "---\nname: platform-demo\n---\n\nBody.\n" }))
    .some((e) => e.includes("description is missing")));
  assert.ok(check(fixture({ "platform-demo": "---\nname: platform-demo\ndescription: x\n---\n" }))
    .some((e) => e.includes("no instructions")));
});

test("an unlinked skill is reported for both agent folders", () => {
  const errors = check(fixture({ "platform-demo": skill("platform-demo") }, {}, false));
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.startsWith(".claude/skills/platform-demo: missing")));
  assert.ok(errors.some((e) => e.startsWith(".agents/skills/platform-demo: missing")));
});

test("dangling links and platform links without a skill fail", () => {
  const errors = check(fixture({ "platform-demo": skill("platform-demo") }, {
    "platform-gone": "../../platform/agent-skills/platform-gone",
  }));
  assert.equal(errors.filter((e) => e.includes("platform-gone")).length, 2);
});

test("links to a different target fail even when they resolve", () => {
  const root = fixture({ "platform-demo": skill("platform-demo") }, {}, false);
  for (const dir of [".claude/skills", ".agents/skills"]) {
    symlinkSync(path.join(root, "platform/agent-skills/platform-demo"), path.join(root, dir, "platform-demo"));
  }
  const errors = check(root);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.includes("expected \"../../platform/agent-skills/platform-demo\"")));
});

test("frontmatter parsing accepts quoted values and rejects nested ones", () => {
  assert.deepEqual(parseFrontmatter('---\nname: "a-b"\ndescription: \'Do x: y.\'\n---\nBody\n'), {
    name: "a-b",
    description: "Do x: y.",
  });
  assert.match(String(parseFrontmatter("---\nname: a\n  nested: b\n---\nBody\n")), /unsupported frontmatter line/);
  assert.match(String(parseFrontmatter("name: a\n")), /must start with/);
});
