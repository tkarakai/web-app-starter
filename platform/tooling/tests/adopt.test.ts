import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { adopt, parseArgs, removeWorkflowJob, repoFromUrl, rewriteRenovate, setAppConfig, slug } from "../adopt.ts";
import { checkZone } from "../check-zone.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file: string): string => readFileSync(path.join(REPO, file), "utf8");

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" }).trim();
}

function write(root: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

test("setAppConfig sets name, email, cookie prefix and ports in the real app.config.ts", () => {
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

test("adopt: a fresh clone is configured, stripped, linked and recorded; the zone check passes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-"));
  for (const file of ["app.config.ts", "renovate.json", "package.json", "turbo.json", "tsconfig.json", "eslint.config.mjs",
    "platform/VERSION", ".github/workflows/ci-verify.yml", ".github/workflows/ci-landing.yml",
    "packages/backend/convex/schema.ts", "packages/backend/convex/http.ts", "packages/backend/convex/convex.config.ts"]) {
    write(root, file, read(file));
  }
  cpSync(path.join(REPO, "platform/templates"), path.join(root, "platform/templates"), { recursive: true });
  for (const skill of ["platform-configure", "platform-deps"]) write(root, `platform/agent-skills/${skill}/SKILL.md`, "---\n");
  write(root, "apps/landing/package.json", "{}");
  write(root, "apps/web/package.json", "{}");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "release");
  const commit = git(root, "rev-parse", "HEAD");

  const lines: string[] = [];
  const errors = adopt(root, { name: "Acme", repo: "acme/acme-app", remove: ["landing"], install: false, build: false },
    (line) => lines.push(line));

  assert.equal(errors, 0, lines.join("\n"));
  const at = (file: string): string => readFileSync(path.join(root, file), "utf8");
  assert.match(at("app.config.ts"), /const productName = "Acme";/);
  assert.match(at("README.md"), /^# Acme$/m);
  assert.equal(at("CLAUDE.md"), read("platform/templates/CLAUDE.md"));
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
