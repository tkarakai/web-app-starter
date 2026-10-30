import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { adopt, parseArgs, removeSample, removeWorkflowJob, repoFromUrl, rewriteRenovate, setAppConfig, slug } from "../adopt.ts";
import { checkZone } from "../check-zone.ts";
import { checkOrganizationMigration } from "../organization-migration-check.ts";
import { inspectOrganizationSource } from "../../../.github/actions/deploy-convex/organization-target.ts";

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

/** Reuse third-party installs, but resolve every workspace import to the adopted source. */
function copyAdoptionSources(root: string, materializeDependencies = false): void {
  const filter = (file: string) => !["node_modules", ".turbo", ".next", ".convex", "coverage", "test-results", "playwright-report"].includes(path.basename(file))
    && !path.basename(file).startsWith(".env") && !/\.(?:log|tsbuildinfo)$/.test(file);
  for (const directory of ["packages", "platform/packages", "apps/web", "platform/config", "platform/templates/adopt", "platform/tooling/e2e"]) {
    cpSync(path.join(REPO, directory), path.join(root, directory), { recursive: true, filter });
  }
  for (const file of ["app.config.ts", "package.json", "bun.lock", "platform/tooling/organization-migration-check.ts", ".github/actions/deploy-convex/organization-source.ts"]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(REPO, file), path.join(root, file));
  }
  const workspaces = ["", "apps/web", ...["packages", "platform/packages"].flatMap(directory =>
    readdirSync(path.join(REPO, directory), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `${directory}/${entry.name}`))];
  for (const workspace of workspaces) {
    const from = path.join(REPO, workspace, "node_modules");
    if (!existsSync(from)) continue;
    const to = path.join(root, workspace, "node_modules");
    const link = (name: string) => {
      const source = realpathSync(path.join(from, name));
      const relative = path.relative(REPO, source);
      let target = !relative.startsWith("..") && !relative.split(path.sep).includes("node_modules") ? path.join(root, relative) : source;
      // The deployment digest deliberately rejects workspace source escaping its
      // checkout. Materialize published packages for the preflight regression,
      // preserving that check instead of teaching it to trust external symlinks.
      if (materializeDependencies && target === source && name !== ".bin") {
        assert(!relative.startsWith("..") && !path.isAbsolute(relative), "preflight fixture requires checkout-local installed dependencies");
        target = path.join(root, relative);
        if (!existsSync(target)) cpSync(source, target, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
      }
      mkdirSync(path.dirname(path.join(to, name)), { recursive: true });
      if (target !== path.join(to, name)) symlinkSync(target, path.join(to, name));
    };
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
      if ([".vite", ".cache"].includes(entry) || materializeDependencies && entry === ".bun") continue;
      if (entry.startsWith("@")) for (const child of readdirSync(path.join(from, entry))) link(`${entry}/${child}`);
      else link(entry);
    }
  }
}

test("sample removal source preflight works before generated declaration refresh", t => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-preflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyAdoptionSources(root, true);
  const declarations = path.join(root, "packages/backend/convex/_generated/api.d.ts");
  const before = readFileSync(declarations, "utf8");
  assert.match(before, /import type .*from "\.\.\/fileAccess\.js"/);
  removeSample(root);
  assert.equal(existsSync(path.join(root, "packages/backend/convex/fileAccess.ts")), false);
  const source = inspectOrganizationSource(root);
  assert.match(source.deploymentVersion, /^[a-f0-9]{64}$/);
  assert.match(source.registryHash, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(declarations, "utf8"), before, "preflight must not rewrite generated bindings");
  write(root, "packages/backend/convex/unclassified.ts", "export const surprise = 1;\n");
  assert.throws(() => inspectOrganizationSource(root), /inventory is incomplete/);
});

test("setAppConfig sets name, email, cookie prefix and ports in the starter configuration fixture", () => {
  const out = setAppConfig(read("app.config.ts"), {
    name: "Acme \"Tasks\"", supportEmail: "help@acme.test", ports: { web: 4001, storybook: 4013 },
  });
  assert.match(out, /^const productName = "Acme \\"Tasks\\"";$/m);
  assert.match(out, /^const supportEmail = "help@acme.test";$/m);
  assert.match(out, /authCookiePrefix: "acme-tasks",/);
  assert.match(out, /^\s+web: 4001,$/m);
  assert.match(out, /^\s+storybook: 4013,$/m);
  assert.match(out, /^\s+admin: 3002,$/m);
  assert.throws(() => setAppConfig(read("app.config.ts"), { name: "x", ports: { nope: 1 } }), /unknown app/);
});

test("generated config loads user strings literally, including replacement metacharacters", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const name = 'Acme $& $` $\' $1 \\ "Tasks"';
  write(root, "app.config.ts", setAppConfig(read("app.config.ts"), {
    name, supportEmail: "help+$&@acme.test", ports: { web: 4001, storybook: 4013 },
  }));
  const { default: config } = await import(pathToFileURL(path.join(root, "app.config.ts")).href);
  assert.equal(config.identity.productName, name);
  assert.equal(config.identity.legalEntity, name);
  assert.equal(config.identity.supportEmail, "help+$&@acme.test");
  assert.equal(config.runtime.ports.web, 4001);
  assert.equal(config.runtime.ports.storybook, 4013);
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
  assert.equal(parseArgs(["--allow-default-branch", "--yes"]).allowDefaultBranch, true);
  assert.throws(() => parseArgs(["--bootstrap"]), /unknown option --bootstrap/);
  assert.equal(parseArgs(["--updates", "app", "--yes"]).updates, "app");
  assert.throws(() => parseArgs(["--updates", "unattended"]), /app, fallback or deferred/);
  assert.equal(slug("Acme Tasks!"), "acme-tasks");
  assert.equal(slug("!!!"), "app");
  assert.equal(repoFromUrl("git@github.com:acme/app.git"), "acme/app");
  assert.equal(repoFromUrl("https://github.com/acme/app"), "acme/app");
  assert.equal(repoFromUrl("/local/path"), undefined);
  assert.deepEqual(parseArgs(["--name", "A", "--port", "web=4001", "--remove", "demo", "--yes"]),
    { yes: true, name: "A", ports: { web: 4001 }, remove: ["demo"] });
  assert.throws(() => parseArgs(["--remove", "web"]), /not one of/);
  assert.throws(() => parseArgs(["--remove", "landing"]), /not one of/);
});

test("removeWorkflowJob removes the job block and its needs entries", () => {
  const out = removeWorkflowJob(read(".github/workflows/ci-verify.yml"), "landing");
  assert.doesNotMatch(out, /^ {2}landing:$/m);
  assert.match(out, /^ {2}storybook:$/m);
  assert.match(out, /needs: \[resolve, shared, web, admin, storybook\]/);
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
  write(root, "apps/demo/package.json", "{}");
  write(root, "apps/web/package.json", "{}");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "release");
  const commit = git(root, "rev-parse", "HEAD");
  const provider = (directory: string) => (file: string, args: string[]) => file === "gh"
    ? JSON.stringify({ full_name: "acme/acme-app", default_branch: "main" }) : git(directory, ...args);
  const services = { release: () => ({ version: read("platform/VERSION").trim(), commit }), command: provider(root) };
  const before = readFileSync(path.join(root, "app.config.ts"), "utf8");
  const refused = parseArgs(["--name", "Acme", "--repo", "acme/acme-app", "--yes"]);
  assert.equal(refused.allowDefaultBranch, undefined);
  assert.throws(() => adopt(root, { ...refused, name: "Acme", repo: "acme/acme-app" }, () => {}, { ...services, release: () => { assert.fail("Default refusal must precede release fetch or other mutations"); } }), /bypasses review/);
  assert.equal(readFileSync(path.join(root, "app.config.ts"), "utf8"), before);
  assert.equal(existsSync(path.join(root, ".platform-base.json")), false);
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.equal(git(root, "remote"), "");
  assert.equal(git(root, "rev-parse", "HEAD"), commit);
  const overrideRoot = mkdtempSync(path.join(tmpdir(), "adopt-override-"));
  t.after(() => rmSync(overrideRoot, { recursive: true, force: true }));
  execFileSync("git", ["clone", "--quiet", root, overrideRoot]);
  const overrideLines: string[] = [];
  assert.equal(adopt(overrideRoot, { name: "Acme", repo: "acme/acme-app", allowDefaultBranch: true, build: false, upstream: false }, line => overrideLines.push(line), { ...services, command: provider(overrideRoot) }), 0);
  assert(overrideLines.some(line => line.includes("Owner-authorized --allow-default-branch") && line.includes("bypasses PR review")));
  assert.equal(git(overrideRoot, "branch", "--show-current"), "main");
  assert.equal(git(overrideRoot, "rev-parse", "HEAD"), commit);
  git(root, "switch", "-c", "adopt/acme");
  // Existing-repository adoption preserves recorded intent and caller customisations.
  const repaired=mkdtempSync(path.join(tmpdir(), "adopt-existing-updates-"));
  t.after(()=>rmSync(repaired,{recursive:true,force:true}));
  execFileSync("git",["clone","--quiet",root,repaired]);
  const record={schemaVersion:1,mode:"fallback",repository:"acme/acme-app",source:"tkarakai/web-app-starter",caller:".github/workflows/update-platform.yml",settings:"https://github.com/acme/acme-app/settings/actions",status:"configured",lastCheck:"2026-10-01T00:00:00Z",ownerActions:[]};
  write(repaired,".github/update-delivery.json",JSON.stringify(record));
  const custom=read("platform/templates/update-platform.yml").replace("23 5 * * 1-5","0 9 * * 2").replace("policy: minor","policy: patch");
  write(repaired,".github/workflows/update-platform.yml",custom);
  git(repaired,"add","-A");git(repaired,"commit","-qm","existing app intent");
  assert.equal(adopt(repaired,{name:"Acme",repo:"acme/acme-app",build:false},()=>{}, {release:()=>({version:read("platform/VERSION").trim(),commit}),command: provider(repaired)}),0);
  assert.equal(readFileSync(path.join(repaired,".github/workflows/update-platform.yml"),"utf8"),custom);
  assert.deepEqual(JSON.parse(readFileSync(path.join(repaired,".github/update-delivery.json"),"utf8")),record);


  write(root, "README.md", "Uncommitted work\n");
  assert.throws(() => adopt(root, { name: "Acme", repo: "acme/acme-app", build: false }), /clean checkout/);
  assert.equal(readFileSync(path.join(root, "README.md"), "utf8"), "Uncommitted work\n");
  rmSync(path.join(root, "README.md"));

  const lines: string[] = [];
  const errors = adopt(root, { name: "Acme $& Co", repo: "acme/acme-app", remove: ["demo"], install: false, build: false },
    (line) => lines.push(line), services);

  assert.equal(errors, 0, lines.join("\n"));
  const at = (file: string): string => readFileSync(path.join(root, file), "utf8");
  assert.match(at("app.config.ts"), /const productName = "Acme \$& Co";/);
  assert.equal(at("README.md").split("\n")[0], "# Acme $& Co");
  assert.equal(at("CLAUDE.md"), read("platform/templates/CLAUDE.md"));
  assert.equal(at(".github/workflows/update-platform.yml"), read("platform/templates/update-platform.yml"));
  assert.equal(JSON.parse(at(".github/update-delivery.json")).mode, "deferred");
  assert.match(at("AGENTS.md"), /update-delivery.json/);
  assert.match(at("renovate.json"), /local>acme\/acme-app\/\/platform\/config\/renovate-preset/);
  assert.equal(existsSync(path.join(root, "apps/demo")), false);
  assert.equal(existsSync(path.join(root, "apps/landing/package.json")), true);
  assert.equal(existsSync(path.join(root, ".github/workflows/ci-landing.yml")), true);
  assert.match(at("tsconfig.json"), /apps\/landing"/);
  JSON.parse(at("tsconfig.json"));
  assert.equal((JSON.parse(at("package.json")) as { scripts: Record<string, string> }).scripts["dev:landing"], "./platform/tooling/dev-start.sh --app=landing");
  assert.notEqual((JSON.parse(at("turbo.json")) as { tasks: Record<string, unknown> }).tasks["@repo/landing#build"], undefined);
  for (const dir of [".claude/skills", ".agents/skills"]) {
    assert.equal(readlinkSync(path.join(root, dir, "platform-deps")), "../../platform/agent-skills/platform-deps");
  }
  assert.deepEqual(JSON.parse(at(".platform-base.json")), { version: read("platform/VERSION").trim(), commit, patches: [] });
  assert.equal(git(root, "remote", "get-url", "upstream"), "https://github.com/tkarakai/web-app-starter.git");
  assert.equal(git(root, "config", "remote.upstream.tagOpt"), "--no-tags");
  assert.equal(git(root, "config", "remote.upstream.fetch"), "+refs/heads/main:refs/remotes/upstream/main");
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
  for (const file of ["projects.ts", "tasks.ts", "files.ts", "sampleTables.ts", "fileAccess.ts", "file-ownership.test.ts"]) write(root, `${backend}${file}`, "sample");
  write(root, "apps/web/src/components/projects/app-sidebar.tsx", "sample");
  write(root, "apps/web/qa/e2e/private-files.spec.ts", "sample browser test");
  write(root, "apps/web/qa/e2e/shard-durations.json", JSON.stringify({ "private-files.spec.ts": 20, "auth-flow.spec.ts": 13 }));
  write(root, `${dashboard}dashboard-client.tsx`, "sample");
  for (const file of ["apps/web/src/components/settings/account-client.tsx", `${dashboard}settings/sessions/sessions-client.tsx`,
    "apps/web/src/components/organizations/organization-client.tsx"]) {
    write(root, file, 'import { AppSidebar } from "@/components/projects/app-sidebar";\n');
  }
  mkdirSync(path.join(root, "apps/web/qa/tests"), { recursive: true });
  write(root, "packages/messages/en.json", JSON.stringify({ projects: {}, tasks: {}, uploads: {}, dashboard: { account: "Settings" } }));
  cpSync(path.join(REPO, "platform/templates/adopt"), path.join(root, "platform/templates/adopt"), { recursive: true });
  removeSample(root);
  assert.equal(existsSync(path.join(root, `${backend}projects.ts`)), false);
  for (const file of [`${backend}fileAccess.ts`, `${backend}file-ownership.test.ts`, "apps/web/qa/e2e/private-files.spec.ts"]) {
    assert.equal(existsSync(path.join(root, file)), false);
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "apps/web/qa/e2e/shard-durations.json"), "utf8")), { "auth-flow.spec.ts": 13 });
  assert.equal(existsSync(path.join(root, "apps/web/src/components/projects")), false);
  assert.equal(readFileSync(path.join(root, `${backend}platform/tables.ts`), "utf8"), "platform bytes");
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "packages/messages/en.json"), "utf8")), { dashboard: { account: "Settings" } });
  assert.equal(readFileSync(path.join(root, `${dashboard}dashboard-client.tsx`), "utf8"), read("platform/templates/adopt/dashboard-client.tsx.txt"));
  assert.equal(existsSync(path.join(root, "apps/web/src/components/app-sidebar.tsx")), true);
});

test("sample removal leaves the retained backend suite runnable", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "adopt-backend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backend = path.join(root, "packages/backend");
  copyAdoptionSources(root);

  removeSample(root);
  for (const file of ["projects.ts", "tasks.ts", "files.ts", "sampleTables.ts", "tenantProjects.ts", "tenantTasks.ts", "tenantFiles.ts", "tenantAccess.ts"]) {
    assert.equal(existsSync(path.join(backend, "convex", file)), false);
  }
  // Keep every recovery boundary; only the explicitly removed domain stages differ.
  const migration = readFileSync(path.join(backend, "convex/organizationMigration.ts"), "utf8");
  const originalMigration = read("packages/backend/convex/organizationMigration.ts");
  assert.equal(migration.slice(migration.indexOf("function checkTables()")), originalMigration.slice(originalMigration.indexOf("function checkTables()")));
  assert.equal(migration.match(/^export const organizationMigrationStages = .*$/m)?.[0],
    originalMigration.match(/^export const organizationMigrationStages = .*$/m)?.[0].replace("...domainStages, ", ""));
  const originalRegistry = (await import(pathToFileURL(path.join(REPO, "packages/backend/convex/organizationMigrationRegistry.ts")).href)).organizationMigrationRegistry;
  const adoptedRegistry = (await import(pathToFileURL(path.join(backend, "convex/organizationMigrationRegistry.ts")).href)).organizationMigrationRegistry;
  assert.deepEqual(adoptedRegistry.tables, Object.fromEntries(Object.entries(originalRegistry.tables).filter(([name]) => !["projects", "tasks", "uploads"].includes(name))));
  assert.deepEqual(adoptedRegistry.functions, Object.fromEntries(Object.entries(originalRegistry.functions).filter(([name]) => !/^(sampleTables|tenantProjects|tenantTasks|tenantFiles|projects|tasks|files):/.test(name))));
  assert.deepEqual(adoptedRegistry.jobs, originalRegistry.jobs);
  assert.deepEqual(adoptedRegistry.components, originalRegistry.components);
  const inventory = await checkOrganizationMigration(root);
  assert(inventory.functions.includes("organizationMigration:recoverForward"));
  assert(!inventory.functions.some(name => /^(tenantProjects|tenantTasks|tenantFiles|projects|tasks|files):/.test(name)));
  write(root, "packages/backend/convex/unclassified.ts", "export const surprise = 1;\n");
  await assert.rejects(checkOrganizationMigration(root), /ORGANIZATION_INVENTORY_INCOMPLETE/);
  rmSync(path.join(backend, "convex/unclassified.ts"));
  const schemaPath = path.join(backend, "convex/schema.ts");
  const schema = readFileSync(schemaPath, "utf8");
  writeFileSync(schemaPath, schema.replace('import { defineSchema }', 'import { defineSchema, defineTable }')
    .replace("...platformTables,", "...platformTables, unclassifiedPrivateRows: defineTable({}),"));
  await assert.rejects(checkOrganizationMigration(root), /missingTables.*unclassifiedPrivateRows/);
  writeFileSync(schemaPath, schema);
  execFileSync("bun", ["run", "typecheck"], { cwd: backend, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
  const web = path.join(root, "apps/web");
  execFileSync("bun", ["run", "typecheck"], { cwd: web, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
  const webTests = execFileSync("bun", ["run", "test:unit", "qa/tests/personal-data.test.tsx", "qa/tests/organization-flows.test.tsx", "qa/tests/organization-picker.test.tsx", "qa/tests/safe-query.test.tsx", "--maxWorkers", "2"], { cwd: web, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
  t.diagnostic(`Adopted web: ${webTests.match(/Tests\s+[^\n]+/)?.[0]}`);
  // --list loads every retained spec without a browser, server or auth ceremony.
  const discovery = execFileSync(path.join(web, "node_modules/.bin/playwright"), ["test", "--list", "--reporter=list"], { cwd: web, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
  assert.match(discovery, /organization-journeys.spec.ts/);
  assert.match(discovery, /organization-security.spec.ts/);
  assert.doesNotMatch(discovery, /private-files.spec.ts/);
  t.diagnostic(`Adopted E2E discovery: ${discovery.match(/Total: [^\n]+/)?.[0]}`);
  const backendTests = execFileSync("bun", ["run", "test:convex", "--maxWorkers", "2"], { cwd: backend, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
  t.diagnostic(`Adopted backend: ${backendTests.match(/Tests\s+[^\n]+/)?.[0]}`);
});
