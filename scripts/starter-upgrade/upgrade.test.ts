import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import * as u from "./upgrade.ts";
import { copyApp, seedBaseline, linkStarter } from "./rehearse.ts";
import { authorBoundary, checkOwnership } from "./check-ownership.ts";
let root: string, app: string, releases: string;
beforeEach(() => {
  fs.mkdirSync(path.join(u.ROOT, ".ci-local-artifacts"), { recursive: true });
  root = fs.mkdtempSync(path.join(u.ROOT, ".ci-local-artifacts/starter-test-"));
  app = path.join(root, "apps/demo"); releases = path.join(root, "releases");
  fs.copyFileSync(path.join(u.ROOT, "tsconfig.base.json"), path.join(root, "tsconfig.base.json"));
  copyApp(app); fs.cpSync(u.RELEASES, releases, { recursive: true }); seedBaseline(app, releases); linkStarter(app);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const plan = (): u.Plan => u.plan(app, releases, "1.0.1");
function change<T>(file: string, edit: (v: T) => void): void { const value = u.readJson<T>(file); edit(value); fs.writeFileSync(file, u.encode(value)); }
function release(edit: (r: Record<string, unknown>) => void): void {
  change<{ releases: Record<string, Record<string, unknown>> }>(path.join(releases, "catalogue.json"), c => edit(c.releases["1.0.1"]));
}
const succeeds: u.Runner = (app, check, log) => {
  fs.writeFileSync(log, "unit-test command result\n");
  if (check.id === "build") { const built = path.join(app, u.ARTIFACT); fs.mkdirSync(path.dirname(built), { recursive: true }); fs.writeFileSync(built, "unit artifact; actual build is exercised by rehearsal"); }
  return 0;
};
function applied(): u.Plan { const p = plan(); u.apply(app, releases, p); return p; }

test("discovery and plans are deterministic without changing app sources or baseline", () => {
  const before = u.sourceFiles(app), lock = fs.readFileSync(path.join(app, u.LOCK));
  assert.deepEqual((u.discover(app, releases) as { availableTargets: string[] }).availableTargets, ["1.0.1"]);
  assert.deepEqual(plan(), plan()); assert.deepEqual(before, u.sourceFiles(app)); assert.deepEqual(lock, fs.readFileSync(path.join(app, u.LOCK)));
});
test("discovery remains usable after normal demo startup in an agent session", async () => {
  for (const dependency of [".bin", "@types", "next", "react", "react-dom", "typescript"]) {
    fs.symlinkSync(path.join(u.ROOT, "apps/demo/node_modules", dependency), path.join(app, "node_modules", dependency), "dir");
  }
  const server = spawn("bun", ["run", "dev", "--port", "0", "--hostname", "127.0.0.1"], {
    cwd: app, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CODEX_CI: "1" },
  });
  const closed = new Promise<void>(resolve => server.once("close", () => resolve()));
  let output = "";
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Demo startup timed out: ${output}`)), 30_000);
      const collect = (data: Buffer): void => {
        output += data.toString();
        const address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (address) { clearTimeout(timer); resolve(address); }
      };
      server.stdout.on("data", collect); server.stderr.on("data", collect);
      server.once("error", error => { clearTimeout(timer); reject(error); });
      server.once("exit", code => { clearTimeout(timer); reject(new Error(`Demo exited ${code}: ${output}`)); });
    });
    // A served asset confirms initialization completed, including optional agent-file generation.
    const response = await fetch(`${url}/northstar.svg`, { signal: AbortSignal.timeout(30_000) });
    await response.arrayBuffer();
    assert.equal(response.status, 200, output);
    const discovery = spawnSync(process.execPath, [path.join(u.ROOT, "scripts/starter-upgrade/upgrade.ts"), "discover", "--app", app, "--releases", releases], { encoding: "utf8" });
    assert.equal(discovery.status, 0, discovery.stderr);
    assert.deepEqual((JSON.parse(discovery.stdout) as { availableTargets: string[] }).availableTargets, ["1.0.1"]);
    assert.equal(plan().to, "1.0.1");
  } finally {
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      const pid = server.pid;
      process.kill(-pid, "SIGTERM");
      const timer = setTimeout(() => process.kill(-pid, "SIGKILL"), 5_000);
      await closed;
      clearTimeout(timer);
    }
  }
});
test("applying preserves application files and cannot claim completion", () => {
  const before = u.sourceFiles(app); applied(); assert.deepEqual(before, u.sourceFiles(app));
  assert.throws(() => u.audit(app, releases), /unverified/); assert.throws(plan, /Incomplete/);
});
test("source edit after planning prevents all writes", () => {
  const p = plan(), original = fs.readFileSync(path.join(app, u.PAYLOADS[1]));
  fs.writeFileSync(path.join(app, "src/business/dispatch.ts"), "// local change\n");
  assert.throws(() => u.apply(app, releases, p), /Stale/); assert.deepEqual(original, fs.readFileSync(path.join(app, u.PAYLOADS[1])));
});
test("edited consumed package is never overwritten", () => {
  fs.writeFileSync(path.join(app, u.PAYLOADS[1]), "// local fork\n"); assert.throws(plan, /drift/);
});
test("unsupported baseline, unknown target and downgrade are rejected", () => {
  change<u.Lock>(path.join(app, u.LOCK), l => { l.release = "0.9.0"; }); assert.throws(plan, /Unsupported baseline/);
  seedBaseline(app, releases); assert.throws(() => u.plan(app, releases, "1.0.0"), /Unsupported or stale/); assert.throws(() => u.plan(app, releases, "9.9.9"), /Unknown target/);
});
test("stale baseline metadata is refused", () => {
  change<u.Lock>(path.join(app, u.LOCK), l => { l.releaseDigest = "stale"; }); assert.throws(plan, /Stale baseline/);
});
test("unknown, duplicate or missing required actions cannot be skipped", () => {
  for (const actions of [null, [], ["unknown-migration"], ["sidebar-finite-width", "sidebar-finite-width"]]) {
    release(r => { r.actions = actions; }); assert.throws(plan, /action/i);
  }
});
test("release urgency and affected layers reach discovery and planning", () => {
  const expected = { affectedLayers: ["starter-sidebar-policy"], securityUrgency: "none" };
  assert.deepEqual((u.discover(app, releases) as { targetDetails: object }).targetDetails, { "1.0.1": expected });
  assert.deepEqual({ affectedLayers: plan().affectedLayers, securityUrgency: plan().securityUrgency }, expected);
});
test("missing and unknown release metadata is refused", () => {
  for (const [key, value, message] of [["affectedLayers", null, /affected layers/], ["affectedLayers", [], /affected layers/], ["affectedLayers", ["operations"], /affected layers/], ["securityUrgency", null, /security urgency/], ["securityUrgency", "urgent", /security urgency/]] as const) {
    fs.copyFileSync(path.join(u.RELEASES, "catalogue.json"), path.join(releases, "catalogue.json")); release(r => { r[key] = value; }); assert.throws(plan, message);
  }
});
test("OS metadata is ignored but unclassified secrets are not", () => {
  const p = plan(); fs.writeFileSync(path.join(app, ".DS_Store"), "finder"); fs.writeFileSync(path.join(app, u.BOUNDARY, ".DS_Store"), "finder");
  assert.deepEqual(p, plan()); fs.writeFileSync(path.join(app, ".env.local"), "SECRET=1\n"); assert.throws(plan, /Unclassified path: .env.local/);
});
test("modified plans cannot remove checks or add destinations", () => {
  for (const field of ["actions", "verification", "changes"] as const) { const p = plan(); p[field] = []; assert.throws(() => u.apply(app, releases, p), /modified/); }
});
test("release destinations cannot target application, generated or escaped paths", () => {
  for (const file of ["src/business/dispatch.ts", "src/components/ui/sidebar.tsx", u.LOCK, "../../outside", "/tmp/escape"]) {
    release(r => { r.files = { [file]: "invalid" }; }); assert.throws(plan, /Unsafe overwrite/);
  }
});
test("symlink destinations are rejected without modifying their targets", () => {
  const file = path.join(app, u.PAYLOADS[1]), outside = path.join(root, "protected.js");
  fs.unlinkSync(file); fs.writeFileSync(outside, "protected"); fs.symlinkSync(outside, file);
  assert.throws(plan, /Symlink/); assert.equal(fs.readFileSync(outside, "utf8"), "protected");
});
test("hardlinked application aliases are rejected", () => {
  fs.linkSync(path.join(app, u.PAYLOADS[1]), path.join(app, "src/business/linked-policy.js")); assert.throws(plan, /Hardlinked/);
});
test("package-manager hardlinks outside source are not overwritten through aliases", () => {
  const alias = path.join(root, "old-installed.js"); fs.linkSync(path.join(app, u.PAYLOADS[1]), alias);
  const before = fs.readFileSync(alias); applied(); assert.deepEqual(before, fs.readFileSync(alias)); assert.notDeepEqual(before, fs.readFileSync(path.join(app, u.PAYLOADS[1])));
});
test("generated paths cannot hide or reclassify source", () => {
  change<u.Manifest>(path.join(app, u.MANIFEST), m => { m.ownership[".starter-upgrade/business.ts"] = "application"; }); assert.throws(plan, /inside generated/);
});
test("unknown paths and source hidden as generated are rejected", () => {
  fs.writeFileSync(path.join(app, "unknown.ts"), "app code"); assert.throws(plan, /Unclassified/);
  change<u.Manifest>(path.join(app, u.MANIFEST), m => { m.ownership["unknown.ts"] = "generated"; }); assert.throws(plan, /hidden/);
});
test("consumed ownership cannot overlap application or unsupported vendoring", () => {
  change<u.Manifest>(path.join(app, u.MANIFEST), m => { m.ownership[u.PAYLOADS[1]] = "application"; }); assert.throws(plan, /override consumed/);
  change<{ ownership: Record<string, string> }>(path.join(app, u.MANIFEST), m => { delete m.ownership[u.PAYLOADS[1]]; m.ownership["src/components/ui/"] = "vendored"; }); assert.throws(plan, /vendoring is not supported/);
});
test("tampered bundles and changed catalogues invalidate plans", () => {
  const p = plan(); release(r => { r.securityUrgency = "high"; }); assert.throws(() => u.apply(app, releases, p), /modified/);
  fs.writeFileSync(path.join(releases, "1.0.1", u.PAYLOADS[1]), "corrupted"); assert.throws(() => u.apply(app, releases, p), /Corrupt/);
});
test("verify without apply cannot claim completion", () => { assert.throws(() => u.verify(app, releases, plan(), succeeds), /Missing applied plan/); });
test("failed command retains negative evidence and pending status", () => {
  const p = applied(); assert.throws(() => u.verify(app, releases, p, (_app, _check, log) => { fs.writeFileSync(log, "failed"); return 1; }), /Verification failed/);
  assert.equal(u.readJson<u.Lock>(path.join(app, u.LOCK)).status, "pending"); assert.equal(u.readJson<u.Evidence>(path.join(app, u.EVIDENCE)).status, "failed"); assert.throws(() => u.audit(app, releases), /unverified/);
});
test("zero exit codes cannot certify stale or missing build output", () => {
  const p = applied(), built = path.join(app, u.ARTIFACT); fs.mkdirSync(path.dirname(built), { recursive: true }); fs.writeFileSync(built, "stale");
  assert.throws(() => u.verify(app, releases, p, (_a, _c, log) => { fs.writeFileSync(log, "no-op"); return 0; }), /Missing built/);
});
test("all required evidence is checked even if the lock digest is updated", () => {
  const p = applied(); u.verify(app, releases, p, succeeds); assert.equal(u.audit(app, releases).status, "verified");
  change<u.Evidence>(path.join(app, u.EVIDENCE), e => { e.results.shift(); });
  change<u.Lock>(path.join(app, u.LOCK), l => { l.evidenceDigest = u.fingerprint(u.readJson(path.join(app, u.EVIDENCE))); });
  assert.throws(() => u.audit(app, releases), /Missing action/);
});
test("log or artifact changes invalidate completion", () => {
  const p = applied(); u.verify(app, releases, p, succeeds);
  fs.writeFileSync(path.join(app, ".starter-upgrade/build.log"), "tampered"); assert.throws(() => u.audit(app, releases), /Unverifiable completion/);
  u.verify(app, releases, p, succeeds); fs.writeFileSync(path.join(app, u.ARTIFACT), "tampered"); assert.throws(() => u.audit(app, releases), /Built artifact/);
});
test("source mutation during verification cannot complete", () => {
  const p = applied(); assert.throws(() => u.verify(app, releases, p, (a, c, log) => { fs.writeFileSync(path.join(a, "README.md"), "changed"); return succeeds(a, c, log); }), /source changed/);
});
test("interrupted copy and removed required action cannot verify", () => {
  const p = applied(); fs.writeFileSync(path.join(app, u.PAYLOADS[1]), "partial"); assert.throws(() => u.verify(app, releases, p, succeeds), /Unverifiable installed/);
  fs.copyFileSync(path.join(releases, "1.0.1", u.PAYLOADS[1]), path.join(app, u.PAYLOADS[1]));
  p.actions = []; p.id = u.fingerprint(Object.fromEntries(Object.entries(p).filter(([key]) => key !== "id")));
  change<u.Lock>(path.join(app, u.LOCK), l => { l.plan = p; }); assert.throws(() => u.verify(app, releases, p, succeeds), /Missing action/);
});
test("CLI rejects unknown schemas with machine-readable failure", () => {
  change<u.Manifest>(path.join(app, u.MANIFEST), m => { m.schemaVersion = 999; });
  const result = spawnSync(process.execPath, [path.join(u.ROOT, "scripts/starter-upgrade/upgrade.ts"), "discover", "--app", app, "--releases", releases], { encoding: "utf8" });
  assert.equal(result.status, 1); assert.equal((JSON.parse(result.stderr) as { status: string }).status, "blocked");
});
test("concurrent commands and stale temporary files cannot write", () => {
  u.exclusive(app, () => assert.throws(() => u.exclusive(app, () => plan()), /Another upgrade command/));
  const p = plan(); fs.writeFileSync(path.join(app, u.LOCK + ".tmp"), "stale"); assert.throws(() => u.apply(app, releases, p));
  assert.equal(u.readJson<u.Lock>(path.join(app, u.LOCK)).release, "1.0.0");
});
test("workspace or stale installed package cannot pass verification", () => {
  const p = applied(), link = path.join(app, "node_modules", u.PACKAGE);
  fs.unlinkSync(link); fs.symlinkSync(path.join(u.ROOT, "packages/starter-sidebar-policy"), link);
  assert.throws(() => u.verify(app, releases, p, succeeds), /workspace source/);
  fs.unlinkSync(link); const stale = path.join(app, "node_modules/stale-policy"); fs.cpSync(path.join(releases, "1.0.0", u.BOUNDARY), stale, { recursive: true }); fs.symlinkSync(stale, link);
  assert.throws(() => u.verify(app, releases, p, succeeds), /differs/);
});
test("private artifact imports and TypeScript aliases cannot bypass the package boundary", () => {
  fs.writeFileSync(path.join(app, "src/private-import.ts"), 'import { clampSidebarWidth } from "../starter-packages/sidebar-policy/dist/index.js"; export const width = clampSidebarWidth(12);');
  assert.throws(() => u.consumerBoundary(app), /package API/);
  fs.unlinkSync(path.join(app, "src/private-import.ts"));
  const config = path.join(app, "tsconfig.json"), value = JSON.parse(fs.readFileSync(config, "utf8")) as { compilerOptions: { paths: Record<string, string[]> } };
  value.compilerOptions.paths[u.PACKAGE] = [path.join(u.ROOT, "packages/starter-sidebar-policy/src/index.ts")];
  fs.writeFileSync(config, JSON.stringify(value));
  assert.throws(() => u.consumerBoundary(app), /workspace source|alias bypasses/);
});
test("demo cannot switch consumption to a workspace dependency", () => {
  const file = path.join(app, "package.json"), pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { dependencies: Record<string, string> }; pkg.dependencies[u.PACKAGE] = "workspace:*"; fs.writeFileSync(file, JSON.stringify(pkg)); assert.throws(plan, /not workspace source/);
});
test("author boundary and demo ownership pass for the actual repository", () => { assert.equal((checkOwnership() as { status: string }).status, "verified"); });
test("author package cannot import application source", () => {
  const author = path.join(root, "packages/starter-sidebar-policy"); fs.cpSync(path.join(u.ROOT, "packages/starter-sidebar-policy"), author, { recursive: true });
  fs.appendFileSync(path.join(author, "src/index.ts"), '\nimport "../../../apps/demo/src/business/dispatch.ts";\n');
  assert.throws(() => authorBoundary(root, path.join(root, "output")), /cannot depend/);
});
