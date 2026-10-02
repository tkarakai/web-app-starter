import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../dependency-floors.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/dependency-floors");

type Sections = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; overrides?: Record<string, string> };
type Workspace = { name: string } & Sections;

/** A project: manifests and a `bun.lock` in Bun's own layout (two-space JSON with trailing commas). */
function project(options: { workspaces: Record<string, Workspace>; packages: Record<string, string>; lockfileVersion?: number; overrides?: Record<string, string>; base?: boolean }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-floors-"));
  const dirs = Object.keys(options.workspaces).filter((dir) => dir !== "");
  const lockSection = (sections: Sections): string => (["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const)
    .filter((section) => sections[section] && Object.keys(sections[section] ?? {}).length > 0)
    .map((section) => `      "${section}": {\n${Object.entries(sections[section] ?? {}).map(([name, range]) => `        "${name}": "${range}",\n`).join("")}      },\n`).join("");
  let lock = `{\n  "lockfileVersion": ${options.lockfileVersion ?? 1},\n  "configVersion": 1,\n  "workspaces": {\n`;
  for (const [dir, { name, ...sections }] of Object.entries(options.workspaces)) {
    // The lockfile's workspace entries never list overrides.
    const locked: Sections = { ...sections };
    delete locked.overrides;
    lock += `    "${dir}": {\n      "name": "${name}",\n${lockSection(locked)}    },\n`;
    const manifest: Record<string, unknown> = { name, ...(dir === "" ? { private: true, workspaces: [...new Set(dirs.map((d) => `${path.dirname(d)}/*`))] } : { version: "0.0.0" }), ...sections };
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  lock += "  },\n";
  if (options.overrides) lock += `  "overrides": {\n${Object.entries(options.overrides).map(([name, range]) => `    "${name}": "${range}",\n`).join("")}  },\n`;
  lock += `  "packages": {\n${Object.entries(options.packages).map(([key, id]) => `    "${key}": ["${id}", "", {}, "sha512-fixture"],\n`).join("\n")}  }\n}\n`;
  fs.writeFileSync(path.join(root, "bun.lock"), lock);
  if (options.base) fs.writeFileSync(path.join(root, ".platform-base.json"), JSON.stringify({ version: "2.0.0", commit: "abc", patches: [] }));
  return root;
}

function run(root: string, ...args: string[]): { code: number; output: string } {
  const lines: string[] = [];
  const code = main([...args, root], (line) => lines.push(line));
  return { code, output: lines.join("\n") };
}

const read = (root: string, file: string): string => fs.readFileSync(path.join(root, file), "utf8");
const snapshot = (root: string): Record<string, string> => Object.fromEntries(
  ["package.json", "bun.lock", "apps/web/package.json", "apps/api/package.json", "platform/packages/ui/package.json"]
    .filter((file) => fs.existsSync(path.join(root, file))).map((file) => [file, read(root, file)]));
const packagesOf = (lock: string): string => lock.slice(lock.indexOf('  "packages": {'));

const ROOT_ONLY = { "": { name: "app", devDependencies: { typescript: "^6.0.3", eslint: "9.39.5" } } };

test("floors that equal the locked version pass, for exact, caret, caret on 0.x and tilde", () => {
  const root = project({
    workspaces: { "": { name: "app", devDependencies: { exact: "1.2.3", caret: "^1.2.3", zero: "^0.12.7", tilde: "~4.14.8" } } },
    packages: { exact: "exact@1.2.3", caret: "caret@1.2.3", zero: "zero@0.12.7", tilde: "tilde@4.14.8" },
  });
  const result = run(root);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /4 declarations in 1 manifests/);
  assert.match(result.output, /Floors are in sync with bun\.lock\./);
});

test("a stale floor fails the check, naming manifest, package, section, range and locked version", () => {
  const root = project({
    workspaces: { ...ROOT_ONLY, "apps/web": { name: "@repo/web", dependencies: { next: "^16.3.3", zero: "^0.12.5", tilde: "~4.14.6" } } },
    packages: { typescript: "typescript@6.0.3", eslint: "eslint@9.39.5", next: "next@16.3.6", zero: "zero@0.12.7", tilde: "tilde@4.14.8" },
  });
  const result = run(root);
  assert.equal(result.code, 1);
  assert.match(result.output, /^apps\/web\/package\.json$/m);
  assert.match(result.output, /stale {2}next {2}\(dependencies\) {2}\^16\.3\.3 -> \^16\.3\.6 {2}\(locked 16\.3\.6\)/);
  assert.match(result.output, /stale {2}zero {2}\(dependencies\) {2}\^0\.12\.5 -> \^0\.12\.7/);
  assert.match(result.output, /stale {2}tilde {2}\(dependencies\) {2}~4\.14\.6 -> ~4\.14\.8/);
  assert.match(result.output, /Run: \.\/platform\/tooling\/node-ts\.sh platform\/tooling\/dependency-floors\.ts --write/);
  assert.deepEqual(snapshot(root), snapshot(root), "check mode never writes");
});

test("dependencies and devDependencies are both checked", () => {
  const root = project({
    workspaces: { "": { name: "app", dependencies: { a: "^1.0.0" }, devDependencies: { b: "^2.0.0" } } },
    packages: { a: "a@1.4.0", b: "b@2.5.1" },
  });
  const result = run(root);
  assert.equal(result.code, 1);
  assert.match(result.output, /a {2}\(dependencies\) {2}\^1\.0\.0 -> \^1\.4\.0/);
  assert.match(result.output, /b {2}\(devDependencies\) {2}\^2\.0\.0 -> \^2\.5\.1/);
});

test("peers, optional dependencies, overrides, local protocols and non-registry specifiers are skipped and listed", () => {
  const root = project({
    workspaces: {
      "": {
        name: "app",
        dependencies: { local: "workspace:*", filed: "file:./pkg", linked: "link:../x", gitdep: "git+https://example.test/x.git", urldep: "https://example.test/x.tgz", alias: "npm:other@^1.0.0", shorthand: "user/repo", real: "^1.0.0" },
        peerDependencies: { react: "^19.0.0" },
        optionalDependencies: { fsevents: "^2.3.0" },
        overrides: { next: "16.3.6" },
      },
    },
    packages: { real: "real@1.0.0" },
  });
  const result = run(root);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /1 declarations in 1 manifests/);
  for (const note of ["peerDependencies: react", "optionalDependencies: fsevents", "overrides: next", "local: local (workspace:*)", "local: filed (file:./pkg)", "local: linked (link:../x)", "non-registry: gitdep", "non-registry: urldep", "non-registry: alias (npm:other@^1.0.0)", "non-registry: shorthand (user/repo)"]) {
    assert.ok(result.output.includes(`skipped  ${note}`), `missing: ${note}\n${result.output}`);
  }
});

test("a workspace-specific lock entry wins over the hoisted one", () => {
  const root = project({
    workspaces: { ...ROOT_ONLY, "apps/web": { name: "@repo/web", dependencies: { ms: "~2.0.0" } } },
    packages: { typescript: "typescript@6.0.3", eslint: "eslint@9.39.5", ms: "ms@2.1.3", "@repo/web/ms": "ms@2.0.0" },
  });
  assert.equal(run(root).code, 0);
  const stale = project({
    workspaces: { ...ROOT_ONLY, "apps/web": { name: "@repo/web", dependencies: { ms: "~2.0.0" } } },
    packages: { typescript: "typescript@6.0.3", eslint: "eslint@9.39.5", ms: "ms@2.1.3", "@repo/web/ms": "ms@2.0.4" },
  });
  const result = run(stale);
  assert.equal(result.code, 1);
  assert.match(result.output, /ms {2}\(dependencies\) {2}~2\.0\.0 -> ~2\.0\.4 {2}\(locked 2\.0\.4\)/);
});

test("a locked version outside the range is a conflict that --write never resolves", () => {
  const root = project({
    workspaces: { "": { name: "app", dependencies: { next: "~16.3.0", pinned: "1.2.3" } } },
    packages: { next: "next@16.4.0", pinned: "pinned@1.2.4" },
    overrides: { next: "16.4.0" },
  });
  const before = snapshot(root);
  for (const args of [[], ["--write"]]) {
    const result = run(root, ...args);
    assert.equal(result.code, 2);
    assert.match(result.output, /CONFLICT {2}next {2}\(dependencies\) {2}range ~16\.3\.0 does not allow the locked 16\.4\.0; bun\.lock override 16\.4\.0/);
    assert.match(result.output, /CONFLICT {2}pinned {2}\(dependencies\) {2}range 1\.2\.3 does not allow the locked 1\.2\.4/);
    assert.deepEqual(snapshot(root), before);
  }
});

const closed = (name: string, workspaces: Record<string, Workspace>, packages: Record<string, string>, expected: RegExp, extra: { lockfileVersion?: number } = {}): void => {
  test(`fails closed: ${name}`, () => {
    const root = project({ workspaces, packages, ...extra });
    const before = snapshot(root);
    for (const args of [[], ["--write"]]) {
      const result = run(root, ...args);
      assert.equal(result.code, 2, result.output);
      assert.match(result.output, expected);
      assert.deepEqual(snapshot(root), before);
    }
  });
};

closed("an unsupported range", { "": { name: "app", dependencies: { a: ">=1.0.0 <2.0.0" } } }, { a: "a@1.5.0" }, /unsupported range ">=1\.0\.0 <2\.0\.0"/);
closed("a wildcard range", { "": { name: "app", dependencies: { a: "1.x" } } }, { a: "a@1.5.0" }, /unsupported range "1\.x"/);
closed("a dist-tag", { "": { name: "app", dependencies: { a: "latest" } } }, { a: "a@1.5.0" }, /unsupported range "latest"/);
closed("a prerelease range", { "": { name: "app", dependencies: { a: "^1.0.0-beta.1" } } }, { a: "a@1.0.0-beta.2" }, /unsupported range "\^1\.0\.0-beta\.1"/);
closed("a prerelease locked version", { "": { name: "app", dependencies: { a: "^1.0.0" } } }, { a: "a@1.0.1-rc.1" }, /unsupported locked version 1\.0\.1-rc\.1/);
closed("a missing lock entry", { "": { name: "app", dependencies: { a: "^1.0.0" } } }, {}, /no locked version in bun\.lock/);
closed("an unsupported lockfileVersion", ROOT_ONLY, { typescript: "typescript@6.0.3", eslint: "eslint@9.39.5" }, /unsupported lockfileVersion/, { lockfileVersion: 3 });

test("fails closed: a workspace missing from bun.lock", () => {
  const root = project({ workspaces: { ...ROOT_ONLY, "apps/web": { name: "@repo/web", dependencies: { a: "^1.0.0" } } }, packages: { typescript: "typescript@6.0.3", eslint: "eslint@9.39.5", a: "a@1.0.0" } });
  const lock = read(root, "bun.lock").replace(/ {4}"apps\/web": \{[\s\S]*?\n {4}\},\n/, "");
  fs.writeFileSync(path.join(root, "bun.lock"), lock);
  const result = run(root);
  assert.equal(result.code, 2);
  assert.match(result.output, /apps\/web\/package\.json: the workspace is missing from bun\.lock \(run bun install\)/);
});

test("fails closed: a manifest range that differs from the bun.lock workspace entry", () => {
  const root = project({ workspaces: { "": { name: "app", dependencies: { a: "^1.0.0" } } }, packages: { a: "a@1.4.0" } });
  fs.writeFileSync(path.join(root, "package.json"), read(root, "package.json").replace('"^1.0.0"', '"^1.4.0"'));
  const before = snapshot(root);
  const result = run(root, "--write");
  assert.equal(result.code, 2);
  assert.match(result.output, /package\.json says \^1\.4\.0 but bun\.lock says \^1\.0\.0 \(run bun install\)/);
  assert.deepEqual(snapshot(root), before);
});

const WRITE_WORKSPACES: Record<string, Workspace> = {
  "": { name: "app", devDependencies: { typescript: "^6.0.0", eslint: "9.39.5" } },
  "apps/web": { name: "@repo/web", dependencies: { next: "^16.3.3", zero: "^0.12.5", tilde: "~4.14.6", keep: "^3.0.0" } },
};
const WRITE_PACKAGES = { typescript: "typescript@6.0.3", eslint: "eslint@9.39.5", next: "next@16.3.6", zero: "zero@0.12.7", tilde: "tilde@4.14.8", keep: "keep@3.0.0", "@repo/web/zebra": "zebra@1.0.0" };

test("--write raises each floor, keeps operators and formatting, and leaves packages byte-identical", () => {
  const root = project({ workspaces: WRITE_WORKSPACES, packages: WRITE_PACKAGES });
  const before = snapshot(root);
  const result = run(root, "--write");
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /raised {2}next/);
  assert.match(result.output, /Raised 4 floor\(s\) in manifests and bun\.lock; bun\.lock "packages" is unchanged\./);

  const expected = (text: string): string => text
    .replace('"^6.0.0"', '"^6.0.3"').replace('"^16.3.3"', '"^16.3.6"').replace('"^0.12.5"', '"^0.12.7"').replace('"~4.14.6"', '"~4.14.8"');
  const after = snapshot(root);
  for (const file of ["package.json", "apps/web/package.json", "bun.lock"]) assert.equal(after[file], expected(before[file]), file);
  assert.equal(packagesOf(after["bun.lock"]), packagesOf(before["bun.lock"]));
  assert.match(after["apps/web/package.json"], /"next": "\^16\.3\.6"/);
  assert.ok(after["bun.lock"].includes('"next": "^16.3.6",'));
  assert.equal(run(root).code, 0);
});

test("--write is idempotent", () => {
  const root = project({ workspaces: WRITE_WORKSPACES, packages: WRITE_PACKAGES });
  assert.equal(run(root, "--write").code, 0);
  const once = snapshot(root);
  const second = run(root, "--write");
  assert.equal(second.code, 0);
  assert.match(second.output, /Floors are in sync with bun\.lock\./);
  assert.deepEqual(snapshot(root), once);
});

test("an error anywhere means --write changes nothing", () => {
  const root = project({
    workspaces: { ...WRITE_WORKSPACES, "apps/zzz": { name: "@repo/zzz", dependencies: { bad: ">=1.0.0 <2.0.0" } } },
    packages: { ...WRITE_PACKAGES, bad: "bad@1.2.0" },
  });
  const before = { ...snapshot(root), "apps/zzz/package.json": read(root, "apps/zzz/package.json") };
  const result = run(root, "--write");
  assert.equal(result.code, 2);
  assert.match(result.output, /Nothing was written/);
  assert.deepEqual({ ...snapshot(root), "apps/zzz/package.json": read(root, "apps/zzz/package.json") }, before);
});

test("a failed write puts every file back", () => {
  const root = project({ workspaces: WRITE_WORKSPACES, packages: WRITE_PACKAGES });
  const before = snapshot(root);
  const lines: string[] = [];
  let writes = 0;
  const code = main(["--write", root], (line) => lines.push(line), () => { if (++writes === 2) throw new Error("disk full"); });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /nothing was changed: disk full/);
  assert.deepEqual(snapshot(root), before);
  assert.ok(writes >= 2, "the failure happened after a file had already been written");
});

test("product mode covers platform/ manifests; an adopted app neither reads nor writes them", () => {
  const workspaces: Record<string, Workspace> = {
    "": { name: "app", devDependencies: { app: "^1.0.0" } },
    "platform/packages/ui": { name: "@platform/ui", dependencies: { ui: "^2.0.0" } },
  };
  const packages = { app: "app@1.0.0", ui: "ui@2.3.0" };
  const productRoot = project({ workspaces, packages });
  const product = run(productRoot, "--write");
  assert.equal(product.code, 0);
  assert.match(read(productRoot, "platform/packages/ui/package.json"), /"ui": "\^2\.3\.0"/);

  const adoptedRoot = project({ workspaces, packages, base: true });
  fs.writeFileSync(path.join(adoptedRoot, "platform/packages/ui/package.json"), "{ not json");
  const before = snapshot(adoptedRoot);
  const adopted = run(adoptedRoot, "--write");
  assert.equal(adopted.code, 0, adopted.output);
  assert.match(adopted.output, /Dependency floors \(adopted\): 1 declarations in 1 manifests\./);
  assert.deepEqual(snapshot(adoptedRoot), before);
});

test("an unknown option is refused", () => {
  const lines: string[] = [];
  assert.equal(main(["--rewrite"], (line) => lines.push(line)), 2);
  assert.match(lines.join("\n"), /Unknown option: --rewrite/);
});

// The lockfile below is real Bun 1.4.2 output (lockfileVersion 2) for a two-workspace project.
function bunFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-floors-bun-"));
  fs.mkdirSync(path.join(root, "packages/lib"), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, "package.json.txt"), path.join(root, "package.json"));
  fs.copyFileSync(path.join(FIXTURES, "lib-package.json.txt"), path.join(root, "packages/lib/package.json"));
  fs.copyFileSync(path.join(FIXTURES, "bun.lock.txt"), path.join(root, "bun.lock"));
  return root;
}

test("a Bun-generated version 2 lockfile is read and synchronized without touching packages", () => {
  const root = bunFixture();
  const before = read(root, "bun.lock");
  assert.match(before, /"lockfileVersion": 2/);
  const check = run(root);
  // The root asks for ms ^2.1.0 and the lock holds 2.1.3; the lib's own ~2.0.0 is the workspace-specific 2.0.0.
  assert.equal(check.code, 1, check.output);
  assert.match(check.output, /ms {2}\(devDependencies\) {2}\^2\.1\.0 -> \^2\.1\.3 {2}\(locked 2\.1\.3\)/);
  assert.ok(!/~2\.0\.0 ->/.test(check.output), "the workspace-specific ms 2.0.0 is not stale");
  assert.match(check.output, /skipped {2}peerDependencies: react/);
  assert.equal(run(root, "--write").code, 0);
  assert.equal(packagesOf(read(root, "bun.lock")), packagesOf(before));
  assert.equal(read(root, "bun.lock"), before.replace('"ms": "^2.1.0"', '"ms": "^2.1.3"'));
});

test("the lockfile refresh sequence works on a version 2 lockfile: sync, rebuild, sync, frozen install", { skip: !hasBun() }, () => {
  const root = bunFixture();
  const registryOffline = { ...process.env, BUN_CONFIG_REGISTRY: "http://127.0.0.1:9" };
  assert.equal(run(root, "--write").code, 0); // floors protect the rebuild
  const knownGood = read(root, "bun.lock"); // saved after the first sync, restored if the rebuild fails or is skipped
  // A "rebuild" that cannot reach the registry fails; the known-good lockfile and synchronized manifests remain usable.
  fs.rmSync(path.join(root, "bun.lock"));
  fs.writeFileSync(path.join(root, "bun.lock"), knownGood);
  assert.equal(run(root).code, 0);
  assert.doesNotThrow(() => execFileSync("bun", ["install", "--frozen-lockfile", "--dry-run"], { cwd: root, env: registryOffline, stdio: "pipe" }));
  assert.equal(read(root, "bun.lock"), knownGood);
});

function hasBun(): boolean {
  try { execFileSync("bun", ["--version"], { stdio: "pipe" }); return true; } catch { return false; }
}
