import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, compareDependencies, parseSnapshot, type Json, type Snapshot } from "./dependency-comparison.ts";

const source = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(source, "../..");
type Plan = ReturnType<typeof compareDependencies>;
let root: string;
const bundle = (spec: string | null, section = "dependencies"): Snapshot => ({ schemaVersion: 1, manifests: { "package.json": spec === null ? {} : { [section]: { react: spec } } } });
const entry = (plan: Plan) => plan.workspaces[0].entries[0];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "dependency-plan-"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  for (const name of ["dependency-plan.ts", "dependency-comparison.ts"]) fs.copyFileSync(path.join(source, name), path.join(root, name));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function inputs(a: Snapshot | null = bundle("18.0.0"), b = bundle("20.0.0"), c = bundle("19.0.0")): string[] {
  const args: string[] = [];
  for (const [flag, value] of [["base", a], ["downstream", b], ["target", c]] as const) {
    if (value === null) continue;
    fs.writeFileSync(path.join(root, `${flag}.json`), JSON.stringify(value));
    args.push(`--${flag}`, `${flag}.json`);
  }
  return args;
}
function cli(args: string[], preload?: string) {
  return spawnSync(process.execPath, [...(preload ? ["--import", preload] : []), path.join(root, "dependency-plan.ts"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: "", HOME: root } });
}
function report(args: string[], status = 0, preload?: string): Plan {
  const result = cli(args, preload);
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout) as Plan;
}

const cases: [string, string | null, string | null, string | null, string, string][] = [
  ["unchanged", "1.0.0", "1.0.0", "1.0.0", "unchanged", "keep-downstream"],
  ["upstream edit", "1.0.0", "1.0.0", "2.0.0", "upstream-only", "candidate-upstream"],
  ["business edit", "1.0.0", "2.0.0", "1.0.0", "downstream-only", "keep-downstream"],
  ["same edit", "1.0.0", "2.0.0", "2.0.0", "converged", "keep-downstream"],
  ["different edit", "1.0.0", "3.0.0", "2.0.0", "divergent", "manual-review"],
  ["starter addition", null, null, "2.0.0", "upstream-only", "candidate-upstream"],
  ["business addition", null, "2.0.0", null, "downstream-only", "keep-downstream"],
  ["same addition", null, "2.0.0", "2.0.0", "converged", "keep-downstream"],
  ["add/add conflict", null, "3.0.0", "2.0.0", "divergent", "manual-review"],
  ["upstream removal", "1.0.0", "1.0.0", null, "upstream-only", "candidate-upstream"],
  ["business removal", "1.0.0", null, "1.0.0", "downstream-only", "keep-downstream"],
  ["delete/edit", "1.0.0", null, "2.0.0", "divergent", "manual-review"],
  ["edit/delete", "1.0.0", "2.0.0", null, "divergent", "manual-review"],
  ["both delete", "1.0.0", null, null, "converged", "keep-downstream"],
];
for (const [label, a, b, c, classification, disposition] of cases) {
  test(`CLI classifies ${label} and preserves downstream intent`, () => {
    const p = report(inputs(bundle(a), bundle(b), bundle(c)));
    assert.deepEqual([entry(p).A, entry(p).B, entry(p).C, entry(p).current], [a, b, c, b]);
    assert.equal(entry(p).classification, classification);
    assert.equal(entry(p).disposition, disposition);
    assert.equal(p.baselineAdvanced, false);
    assert.equal(p.compatibility, "not-assessed");
    assert.equal(p.security, "not-assessed");
  });
}

test("missing base is inventory with exit 2, never inferred adoption", () => {
  const p = report(inputs(null, bundle("1.0.0"), bundle("1.0.0")), 2);
  assert.equal(p.mode, "inventory-only");
  assert.equal(p.inputHashes.base, null);
  assert.equal(entry(p).classification, "inventory-equal");
  assert.equal(entry(p).exactVersionDirection.AtoC, "base-missing");
  assert.equal(entry(report(inputs(null), 2)).classification, "inventory-different");
});

test("strict exact annotations compare huge segments numerically and retain every opaque spec", () => {
  for (const [a, b, expected] of [["9.0.0", "10.0.0", "increase"], ["1.9.0", "1.10.0", "increase"], ["1.0.10", "1.0.9", "decrease"], ["9007199254740993.0.0", "9007199254740992.0.0", "decrease"], ["0.0.0", "0.0.0", "equal"]]) {
    assert.equal(entry(compareDependencies(bundle(a), bundle(a), bundle(b))).exactVersionDirection.BtoC, expected);
  }
  for (const spec of ["^0.2.0", "~1.0.0", "*", "1.x", "1.0.0 || 2.0.0", ">=1 <3", "1.0.0-beta.1", "1.0.0+build", "v1.0.0", "01.0.0", " 1.0.0 ", "latest", "workspace:*", "file:./local", "npm:react@19", "git+ssh://git@host/repo#abc", "https://host/file.tgz", "patch:foo", "broken version"]) {
    const e = entry(compareDependencies(bundle("1.0.0"), bundle(spec), bundle("2.0.0")));
    assert.equal(e.B, spec);
    assert.equal(e.current, spec);
    assert.equal(e.exactVersionDirection.BtoC, "unsupported");
    assert.ok(e.reviewReasons.includes("semantic-assessment-unsupported"));
  }
});

test("inventory diagnostics compare supplied workspace names and section memberships", () => {
  const b = bundle("1.0.0");
  b.manifests["package.json"].name = "web";
  const same = report(inputs(null, b, b), 2);
  assert.deepEqual(same.workspaces[0].names, { A: null, B: "web", C: "web" });
  assert.deepEqual(same.workspaces[0].reviewReasons, []);
  assert.equal(entry(same).disposition, "keep-downstream");
  b.manifests["package.json"].devDependencies = { react: "1.0.0" };
  const multiple = report(inputs(null, b, b), 2);
  for (const e of multiple.workspaces[0].entries) {
    assert.ok(e.reviewReasons.includes("multiple-sections-review"));
    assert.ok(!e.reviewReasons.includes("section-move-review"));
    assert.equal(e.disposition, "manual-review");
  }
  const c = bundle("1.0.0", "devDependencies");
  c.manifests["package.json"].name = "renamed";
  for (const [left, right] of [[b, c], [c, b]]) {
    const changed = report(inputs(null, left, right), 2);
    assert.ok(changed.workspaces[0].reviewReasons.includes("workspace-name-review"));
    assert.ok(changed.workspaces[0].entries.every(e => e.reviewReasons.includes("section-move-review")));
  }
  const withBase = report(inputs(bundle(null), b, b));
  assert.ok(withBase.workspaces[0].reviewReasons.includes("workspace-name-review"));
  assert.ok(withBase.workspaces[0].entries.every(e => e.reviewReasons.includes("section-move-review")));
});

test("trailing line terminators remain opaque across every snapshot and ordering direction", () => {
  for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    for (const index of [0, 1, 2]) {
      const specs = ["2.0.0", "2.0.0", "1.0.0"];
      specs[index] += suffix;
      const e = entry(report(inputs(bundle(specs[0]), bundle(specs[1]), bundle(specs[2]))));
      assert.deepEqual([e.A, e.B, e.C, e.current], [...specs, specs[1]]);
      assert.deepEqual(e.specKinds, {
        A: index === 0 ? "opaque-spec" : "exact-stable",
        B: index === 1 ? "opaque-spec" : "exact-stable",
        C: index === 2 ? "opaque-spec" : "exact-stable",
      });
      assert.deepEqual(e.exactVersionDirection, {
        AtoB: index === 2 ? "equal" : "unsupported",
        AtoC: index === 1 ? "decrease" : "unsupported",
        BtoC: index === 0 ? "decrease" : "unsupported",
      });
      assert.ok(e.reviewReasons.includes("semantic-assessment-unsupported"));
      assert.equal(e.reviewReasons.includes("target-lower-than-downstream"), index === 0);
    }
  }
});

test("newer downstream, root overrides, required and optional peers remain unassessed with source locations", () => {
  const a = bundle("18.0.0"), b = bundle("20.0.0"), c = bundle("19.0.0");
  b.manifests["package.json"].overrides = { react: "20.0.0", nested: { react: "$react" } };
  c.manifests["package.json"].overrides = { react: "19.0.0" };
  c.manifests["packages/next/package.json"] = { name: "next", peerDependencies: { react: "^19.0.0" } };
  c.manifests["packages/adapter/package.json"] = { name: "adapter", peerDependencies: { react: "^18.0.0 || ^19.0.0", "better-auth": ">=1.6.11 <1.7.0", absent: "^1.0.0" }, peerDependenciesMeta: { react: { optional: true }, absent: { optional: true } } };
  c.manifests["packages/third/package.json"] = { peerDependencies: { react: "^18.0.0 || ^20.0.0" } };
  const p = report(inputs(a, b, c));
  const rootWorkspace = p.workspaces.find(w => w.path === "package.json")!;
  assert.equal(rootWorkspace.entries[0].current, "20.0.0");
  assert.ok(rootWorkspace.entries[0].reviewReasons.includes("target-lower-than-downstream"));
  assert.deepEqual(rootWorkspace.policyReviews[0].current, b.manifests["package.json"].overrides);
  for (const w of p.workspaces.filter(w => w.path !== "package.json")) {
    assert.ok(w.entries.every(e => e.reviewReasons.includes("peer-constraints-not-assessed")));
    assert.ok(w.entries.every(e => e.compatibility === "not-assessed"));
  }
  assert.deepEqual(p.workspaces.find(w => w.path.includes("adapter"))!.policyReviews[0].C, c.manifests["packages/adapter/package.json"].peerDependenciesMeta);
  assert.equal(p.security, "not-assessed"); // Even a newer exact declaration is not security evidence.
});

test("section moves, missing paths and duplicate names are manual without flattening workspaces", () => {
  const a = bundle("1.0.0"), b = bundle("1.0.0"), c = bundle("2.0.0", "devDependencies");
  b.manifests["packages/one/package.json"] = { name: "same", dependencies: { react: "19.0.0" } };
  b.manifests["packages/two/package.json"] = { name: "same", dependencies: { react: "20.0.0" } };
  const p = report(inputs(a, b, c));
  assert.equal(p.workspaces.length, 3);
  for (const w of p.workspaces.filter(w => w.path !== "package.json")) {
    assert.ok(w.reviewReasons.includes("workspace-mapping-review"));
    assert.ok(w.reviewReasons.includes("duplicate-workspace-name"));
    assert.equal(w.entries[0].disposition, "manual-review");
  }
  for (const e of p.workspaces.find(w => w.path === "package.json")!.entries) {
    assert.equal(e.disposition, "manual-review");
    assert.ok(e.reviewReasons.includes("section-move-review"));
  }
});

test("identity is asserted only and hashes cover all supplied input including policy and unrelated fields", () => {
  const a = bundle("1.0.0"), b = bundle("1.0.0"), c = bundle("2.0.0");
  a.claimedStarterIdentity = { origin: "old", digest: "untrusted", components: { auth: "1" } };
  b.claimedStarterIdentity = { origin: "other", digest: "mismatch", components: { auth: "2", ui: "1" } };
  const original = compareDependencies(a, b, c);
  assert.equal(original.identity.assessment, "asserted-not-verified");
  assert.deepEqual(original.identity.B, b.claimedStarterIdentity);
  for (const index of [0, 1, 2]) {
    const changed = globalThis.structuredClone([a, b, c]);
    changed[index].manifests["package.json"].description = "any input edit";
    assert.notEqual(compareDependencies(...changed as [Snapshot, Snapshot, Snapshot]).id, original.id);
  }
  for (const [field, value] of Object.entries({ overrides: { react: "3.0.0" }, engines: { node: "24.x" }, packageManager: "bun@1.4.2", workspaces: ["apps/*"], catalog: { react: "^19" } })) {
    const changed = globalThis.structuredClone(c);
    changed.manifests["package.json"][field] = value as Json;
    const p = compareDependencies(a, b, changed);
    assert.notEqual(p.id, original.id);
    assert.equal(p.workspaces[0].policyReviews[0].disposition, "manual-review");
  }
});

test("CLI bytes and ID ignore input key ordering, whitespace, paths and run time", () => {
  const args = inputs();
  const first = cli(args);
  for (const file of ["base.json", "downstream.json", "target.json"]) {
    const value = JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as Json;
    function reverse(v: Json): Json { return Array.isArray(v) ? v.map(reverse) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v; }
    fs.writeFileSync(path.join(root, file), JSON.stringify(reverse(value), null, 4));
  }
  assert.equal(cli(args).stdout, first.stdout);
  fs.copyFileSync(path.join(root, "target.json"), path.join(root, "renamed.json"));
  assert.equal(cli(args.map(x => x === "target.json" ? "renamed.json" : x)).stdout, first.stdout);
});

test("malformed JSON, duplicate keys, invalid shapes, unsafe paths and unsupported fields refuse", () => {
  const invalid: unknown[] = [null, [], {}, { schemaVersion: 2, manifests: {} }, { schemaVersion: 1, manifests: {} }, { ...bundle(null), unknown: true }, { ...bundle(null), claimedStarterIdentity: "tag" },
    ...[null, [], "oops", { react: 19 }, { react: "" }].map(dependencies => ({ schemaVersion: 1, manifests: { "package.json": { dependencies } } })),
    ...["/package.json", "../package.json", "apps/../package.json", "apps//web/package.json", "./package.json", "C:/package.json", "apps\\web/package.json", "apps/web/not-manifest.json"].map(file => ({ schemaVersion: 1, manifests: { "package.json": {}, [file]: {} } })),
    ...[{ overrides: [] }, { engines: { node: 24 } }, { workspaces: 12 }, { packageManager: null }, { peerDependenciesMeta: { react: { optional: "yes" } } }].map(manifest => ({ schemaVersion: 1, manifests: { "package.json": manifest } })),
  ];
  const args = inputs();
  const texts = [...invalid.map(v => JSON.stringify(v)), '{"schemaVersion":1,"manifests":{"package.json":{},"package\\u002ejson":{}}}', '{"schemaVersion":1,"schemaVersion":1,"manifests":{"package.json":{}}}', "{broken", '{"schemaVersion":1,"manifests":{"package.json":null}}', '{"schemaVersion":1,"claimedStarterIdentity":{"number":1e999},"manifests":{"package.json":{}}}'];
  for (const text of texts) {
    fs.writeFileSync(path.join(root, "target.json"), text);
    const result = cli(args);
    assert.equal(result.status, 1, text);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).status, "refused");
  }
});

test("help, missing input, unknown/apply/output flags, duplicate flags and unreadable files have explicit exits", () => {
  assert.equal(cli(["--help"]).status, 0);
  const args = inputs();
  for (const argv of [[], ["--base"], [...args, "--apply"], [...args, "--output", "output.json"], [...args, "--base", "base.json"], ["--downstream", "missing.json", "--target", "target.json"], [...args, "--help"]]) {
    const result = cli(argv);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(JSON.parse(result.stderr).status, "refused");
  }
});

test("prototype-looking names are data, not inherited declarations", () => {
  const snapshot = parseSnapshot('{"schemaVersion":1,"manifests":{"package.json":{"dependencies":{"__proto__":"1.0.0","constructor":"2.0.0"}}}}');
  const p = compareDependencies(snapshot, snapshot, snapshot);
  assert.deepEqual(p.workspaces[0].entries.map(e => [e.name, e.B]), [["__proto__", "1.0.0"], ["constructor", "2.0.0"]]);
  assert.equal(canonical(JSON.parse('{"__proto__":{"safe":true}}') as Json), '{"__proto__":{"safe":true}}');
});

function tree(dir: string): Json {
  return Object.fromEntries(fs.readdirSync(dir).sort().map(name => {
    const file = path.join(dir, name), stat = fs.lstatSync(file);
    return [name, stat.isDirectory() ? tree(file) : { mode: stat.mode, content: fs.readFileSync(file).toString("base64") }];
  }));
}
test("standalone CLI cannot spawn/network/write and leaves source, index, locks, baseline and caches intact", () => {
  const b = bundle("20.0.0");
  b.manifests["package.json"].scripts = { postinstall: "touch executed-script" };
  const args = inputs(bundle("18.0.0"), b);
  for (const file of [".git/index", "bun.lock", "starter-upgrade.lock.json", "src/business.ts", ".cache/sentinel", ".starter-upgrade/guard/sentinel"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "preserve");
  }
  const fence = path.join(root, "fence.mjs");
  fs.writeFileSync(fence, `import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const fail = () => { throw new Error('SIDE_EFFECT_FENCED'); };
for (const [name, methods] of Object.entries({child_process:['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'], net:['connect','createConnection','createServer'], http:['request','get','createServer'], https:['request','get','createServer'], tls:['connect','createServer'], dns:['lookup','resolve'], dgram:['createSocket'], fs:['writeFileSync','appendFileSync','mkdirSync','rmSync','renameSync','unlinkSync','copyFileSync','cpSync','createWriteStream']})) {
 const module = require('node:' + name); for (const method of methods) module[method] = fail;
}
for (const method of ['writeFile','appendFile','mkdir','rm','rename','unlink','copyFile','cp','open']) require('node:fs/promises')[method] = fail;
const fs = require('node:fs'), open = fs.openSync;
fs.openSync = (file, flags, ...rest) => flags === 'r' || flags === 0 ? open(file, flags, ...rest) : fail();
globalThis.fetch = fail; globalThis.WebSocket = class { constructor() { fail(); } };
syncBuiltinESMExports();`);
  for (const command of ["require('node:child_process').spawnSync('git', ['status'])", "require('node:https').get('https://example.com')", "require('node:fs').writeFileSync('bad', 'bad')"]) {
    const control = spawnSync(process.execPath, ["--import", fence, "-e", command], { cwd: root, encoding: "utf8" });
    assert.notEqual(control.status, 0);
    assert.match(control.stderr, /SIDE_EFFECT_FENCED/);
  }
  const before = tree(root);
  report(args, 0, fence);
  assert.equal(cli([...args, "--apply"], fence).status, 1);
  assert.equal(cli(["--downstream", "missing", "--target", "target.json"], fence).status, 1);
  assert.deepEqual(tree(root), before);
  fs.writeFileSync(path.join(root, "target.json"), "null");
  const malformedBefore = tree(root);
  assert.equal(cli(args, fence).status, 1);
  assert.deepEqual(tree(root), malformedBefore);
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
});

test("actual checked-in root, web, demo, auth and workspace peer manifests retain their distinct declarations", () => {
  const paths = ["package.json", "apps/web/package.json", "apps/demo/package.json", "packages/auth/package.json", "packages/backend/package.json", "packages/design-system/package.json"];
  const actual: Snapshot = { schemaVersion: 1, manifests: Object.fromEntries(paths.map(file => [file, JSON.parse(fs.readFileSync(path.join(repo, file), "utf8"))])) };
  const p = report(inputs(actual, actual, actual));
  assert.equal(p.workspaces.length, paths.length);
  for (const file of paths) {
    const workspace = p.workspaces.find(w => w.path === file)!;
    for (const e of workspace.entries) {
      assert.equal(e.B, (actual.manifests[file][e.section] as Record<string, string>)[e.name]);
      assert.equal(e.classification, "unchanged");
    }
  }
  const demo = p.workspaces.find(w => w.path === "apps/demo/package.json")!;
  assert.equal(demo.entries.find(e => e.name === "@repo/starter-sidebar-policy")!.specKinds.B, "opaque-protocol");
  assert.ok(demo.entries.some(e => e.specKinds.B === "opaque-spec"));
  assert.ok(p.workspaces.find(w => w.path === "apps/web/package.json")!.entries.some(e => e.specKinds.B === "exact-stable"));
  assert.ok(p.workspaces.find(w => w.path === "packages/auth/package.json")!.entries.some(e => e.section === "peerDependencies" && e.reviewReasons.includes("peer-constraints-not-assessed")));
  assert.ok(p.workspaces.find(w => w.path === "package.json")!.policyReviews.some(e => e.field === "overrides"));
  assert.equal(p.compatibility, "not-assessed");
});
