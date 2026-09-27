import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { adopt, parseArgs, removeSample, removeWorkflowJob, repoFromUrl, rewriteRenovate, setAppConfig, slug } from "../adopt.ts";
import { checkZone } from "../check-zone.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file: string): string => {
  const fixture = path.join(REPO, "platform/tooling/tests/fixtures/adopt", `${file}.txt`);
  return readFileSync(existsSync(fixture) ? fixture : path.join(REPO, file), "utf8");
};

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" }).trim();
}

function write(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

test("setAppConfig sets name, email, cookie prefix and ports in the starter configuration fixture", () => {
  const out = setAppConfig(read("app.config.ts"), {
    name: "Acme \"Tasks\"", supportEmail: "help@acme.test", ports: { web: 4001, "landing-static": 4004 },
  });
  assert.match(out, /^const productName = "Acme \\"Tasks\\"";$/m);
  assert.match(out, /^const supportEmail = "help@acme.test";$/m);
  assert.match(out, /authCookiePrefix: "acme-tasks",/);
  assert.match(out, /^\s+web: 4001,$/m);
  assert.match(out, /^\s+"landing-static": 4004,$/m);
  assert.match(out, /^\s+admin: 3002,$/m);
  assert.throws(() => setAppConfig(read("app.config.ts"), { name: "x", ports: { nope: 1 } }), /unknown app/);
});

test("generated config loads user strings literally, including replacement metacharacters", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const name = 'Acme $& $` $\' $1 \\ "Tasks"';
  write(root, "app.config.ts", setAppConfig(read("app.config.ts"), {
    name, supportEmail: "help+$&@acme.test", ports: { web: 4001, "landing-static": 4004 },
  }));
  const { default: config } = await import(pathToFileURL(path.join(root, "app.config.ts")).href);
  assert.equal(config.identity.productName, name);
  assert.equal(config.identity.legalEntity, name);
  assert.equal(config.identity.supportEmail, "help+$&@acme.test");
  assert.equal(config.runtime.ports.web, 4001);
  assert.equal(config.runtime.ports["landing-static"], 4004);
  assert.equal(config.runtime.ports.admin, 3002);
});

test("workflow job names with regex syntax cannot remove another dependency", () => {
  const workflow = "jobs:\n  app.web:\n    runs-on: ubuntu-latest\n  verify:\n    needs: [shared, appXweb, app.web]\n";
  assert.equal(removeWorkflowJob(workflow, "app.web"),
    "jobs:\n  verify:\n    needs: [shared, appXweb]\n");
});

test("rewriteRenovate points the preset at the app's repo and drops product-only rules", () => {
  const out = JSON.parse(rewriteRenovate(read("renovate.json"), "acme/acme-app")) as Record<string, unknown>;
  assert.deepEqual(out.extends, ["local>acme/acme-app//platform/config/renovate-preset"]);
  assert.equal(out.ignorePaths, undefined);
  assert.equal(out.packageRules, undefined);
  assert.equal(out.timezone, "Europe/Budapest");
});

test("helpers: slug, repoFromUrl, parseArgs", () => {
  assert.equal(slug("Acme Tasks!"), "acme-tasks");
  assert.equal(slug("!!!"), "app");
  assert.equal(repoFromUrl("git@github.com:acme/app.git"), "acme/app");
  assert.equal(repoFromUrl("https://github.com/acme/app"), "acme/app");
  assert.equal(repoFromUrl("/local/path"), undefined);
  assert.deepEqual(parseArgs(["--name", "A", "--port", "web=4001", "--remove", "demo,landing", "--yes"]),
    { yes: true, name: "A", ports: { web: 4001 }, remove: ["demo", "landing"] });
  assert.throws(() => parseArgs(["--remove", "web"]), /not one of/);
});

test("removeWorkflowJob removes the job block and its needs entries", () => {
  const out = removeWorkflowJob(read(".github/workflows/ci-verify.yml"), "landing");
  assert.doesNotMatch(out, /^ {2}landing:$/m);
  assert.match(out, /^ {2}landing-static:$/m);
  assert.match(out, /needs: \[resolve, shared, web, admin, landing-static, storybook\]/);
});

test("adopt: a fresh clone is configured, stripped, linked and recorded; the zone check passes", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ["app.config.ts", "renovate.json", "package.json", "turbo.json", "tsconfig.json", "eslint.config.mjs",
    "platform/VERSION", ".github/workflows/ci-verify.yml", ".github/workflows/ci-landing.yml",
    "packages/backend/convex/schema.ts", "packages/backend/convex/http.ts", "packages/backend/convex/convex.config.ts"]) {
    write(root, file, read(file));
  }
  cpSync(path.join(REPO, "platform/templates"), path.join(root, "platform/templates"), { recursive: true });
  for (const skill of ["platform-configure", "platform-deps"]) {
    write(root, `platform/agent-skills/${skill}/SKILL.md`, "---\n");
    for (const directory of [".agents/skills", ".claude/skills"]) {
      mkdirSync(path.join(root, directory), { recursive: true });
      symlinkSync(`../../platform/agent-skills/${skill}`, path.join(root, directory, skill));
    }
  }
  write(root, "apps/landing/package.json", "{}");
  write(root, "apps/web/package.json", "{}");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "release");
  const commit = git(root, "rev-parse", "HEAD");

  write(root, "README.md", "Uncommitted work\n");
  assert.throws(() => adopt(root, { name: "Acme", repo: "acme/acme-app", build: false }), /clean checkout/);
  assert.equal(readFileSync(path.join(root, "README.md"), "utf8"), "Uncommitted work\n");
  rmSync(path.join(root, "README.md"));

  const lines: string[] = [];
  const errors = adopt(root, { name: "Acme $& Co", repo: "acme/acme-app", remove: ["landing"], install: false, build: false },
    (line) => lines.push(line));

  assert.equal(errors, 0, lines.join("\n"));
  const at = (file: string): string => readFileSync(path.join(root, file), "utf8");
  assert.match(at("app.config.ts"), /const productName = "Acme \$& Co";/);
  assert.equal(at("README.md").split("\n")[0], "# Acme $& Co");
  assert.equal(at("CLAUDE.md"), read("platform/templates/CLAUDE.md"));
  assert.equal(at(".github/workflows/update-platform.yml"), read("platform/templates/update-platform.yml"));
  assert.match(at("renovate.json"), /local>acme\/acme-app\/\/platform\/config\/renovate-preset/);
  assert.equal(existsSync(path.join(root, "apps/landing")), false);
  assert.equal(existsSync(path.join(root, ".github/workflows/ci-landing.yml")), false);
  assert.doesNotMatch(at("tsconfig.json"), /apps\/landing"/);
  JSON.parse(at("tsconfig.json"));
  assert.equal((JSON.parse(at("package.json")) as { scripts: Record<string, string> }).scripts["dev:landing"], undefined);
  assert.equal((JSON.parse(at("turbo.json")) as { tasks: Record<string, unknown> }).tasks["@repo/landing#build"], undefined);
  for (const dir of [".claude/skills", ".agents/skills"]) {
    assert.equal(readlinkSync(path.join(root, dir, "platform-deps")), "../../platform/agent-skills/platform-deps");
  }
  assert.deepEqual(JSON.parse(at(".platform-base.json")), { version: read("platform/VERSION").trim(), commit, patches: [] });
  assert.equal(git(root, "remote", "get-url", "upstream"), "https://github.com/tkarakai/web-app-starter.git");
  assert.equal(checkZone(root).mode, "adopted");
  assert.throws(() => adopt(root, { name: "Acme", repo: "acme/acme-app", build: false }), /already adopted/);
});

test("sample removal replaces domain UI and retains account messages and platform bytes", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-sample-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backend = "packages/backend/convex/";
  const dashboard = "apps/web/src/app/[locale]/(dashboard)/dashboard/";
  write(root, `${backend}schema.ts`, read(`${backend}schema.ts`));
  write(root, `${backend}platform/tables.ts`, "platform bytes");
  for (const file of ["projects.ts", "tasks.ts", "files.ts", "sampleTables.ts"]) write(root, `${backend}${file}`, "sample");
  write(root, "apps/web/src/components/projects/app-sidebar.tsx", "sample");
  write(root, `${dashboard}dashboard-client.tsx`, "sample");
  for (const file of ["apps/web/src/components/settings/account-client.tsx", `${dashboard}settings/sessions/sessions-client.tsx`]) {
    write(root, file, 'import { AppSidebar } from "@/components/projects/app-sidebar";\n');
  }
  mkdirSync(path.join(root, "apps/web/qa/tests"), { recursive: true });
  write(root, "packages/messages/en.json", JSON.stringify({ projects: {}, tasks: {}, uploads: {}, dashboard: { account: "Settings" } }));
  cpSync(path.join(REPO, "platform/templates/adopt"), path.join(root, "platform/templates/adopt"), { recursive: true });
  removeSample(root);
  assert.equal(existsSync(path.join(root, `${backend}projects.ts`)), false);
  assert.equal(existsSync(path.join(root, "apps/web/src/components/projects")), false);
  assert.equal(readFileSync(path.join(root, `${backend}platform/tables.ts`), "utf8"), "platform bytes");
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "packages/messages/en.json"), "utf8")), { dashboard: { account: "Settings" } });
  assert.equal(readFileSync(path.join(root, `${dashboard}dashboard-client.tsx`), "utf8"), read("platform/templates/adopt/dashboard-client.tsx.txt"));
  assert.equal(existsSync(path.join(root, "apps/web/src/components/app-sidebar.tsx")), true);
});
