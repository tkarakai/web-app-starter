/** Two checkouts on one machine run managed CI/E2E stacks at the same time (#414). */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const nodeTs = path.join(root, "platform/tooling/node-ts.sh");
const portsModule = path.join(root, "platform/tooling/e2e-ports.ts");

function leaseDirectory(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "port-leases-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A Playwright runner stand-in: plans its stack, reports the plan, then holds it while servers would start. */
function runner(leases: string, holdMs: number) {
  const script = `import { e2eOrigin } from ${JSON.stringify(portsModule)};
e2eOrigin("web");
process.stdout.write(process.env.PLATFORM_E2E_PORTS + "\\n");
setTimeout(() => {}, ${holdMs});`;
  const environment: Record<string, string | undefined> = { ...process.env, PLATFORM_PORT_LEASE_DIR: leases };
  delete environment.PLATFORM_E2E_PORTS;
  const child = spawn(nodeTs, ["--input-type=module", "-e", script], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { errors += String(chunk); });
  const plan = new Promise<Record<string, number>>((resolve, reject) => {
    child.stdout.on("data", () => { if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0]) as Record<string, number>); });
    child.once("exit", code => reject(new Error(`runner exited ${code} before planning: ${errors}`)));
  });
  return { child, plan, exited: once(child, "exit") };
}

test("two runners planning at the same moment never share a port", async t => {
  const leases = leaseDirectory(t);
  const first = runner(leases, 3000), second = runner(leases, 3000);
  t.after(() => { first.child.kill(); second.child.kill(); });
  const [a, b] = await Promise.all([first.plan, second.plan]);
  const shared = Object.values(a).filter(port => Object.values(b).includes(port));
  assert.deepEqual(shared, [], `plans overlap: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
});

test("a plan held by a live runner is never handed out before its servers bind", async t => {
  const leases = leaseDirectory(t);
  const holder = runner(leases, 5000);
  t.after(() => holder.child.kill());
  const held = await holder.plan;
  // Nothing listens on the held plan yet: a probe-then-bind selection would reuse it.
  for (let attempt = 0; attempt < 5; attempt++) {
    const contender = runner(leases, 0);
    const plan = await contender.plan;
    await contender.exited;
    const shared = Object.values(plan).filter(port => Object.values(held).includes(port));
    assert.deepEqual(shared, [], `attempt ${attempt} reused held ports: ${JSON.stringify(plan)} / ${JSON.stringify(held)}`);
  }
});

test("a finished runner releases its plan", async t => {
  const leases = leaseDirectory(t);
  const finished = runner(leases, 0);
  await finished.plan;
  await finished.exited;
  assert.deepEqual(fs.readdirSync(leases).filter(name => !name.startsWith(".")), []);
});

/** A checkout copy with only the preflight it needs and a private HOME. */
function checkout(t: TestContext, legacy: string | undefined, backendEnv: string | undefined) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "convex-state-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const home = path.join(directory, "home");
  fs.mkdirSync(home);
  if (legacy) {
    const state = path.join(home, ".convex/anonymous-convex-backend-state", legacy);
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, "config.json"), JSON.stringify({ ports: { cloud: 3210, site: 3211 }, adminKey: "legacy-key", backendVersion: "precompiled-fixture" }));
  }
  const project = path.join(directory, "project");
  fs.mkdirSync(path.join(project, "packages/backend"), { recursive: true });
  if (backendEnv !== undefined) fs.writeFileSync(path.join(project, "packages/backend/.env.local"), backendEnv);
  const environment: Record<string, string | undefined> = { ...process.env, HOME: home };
  for (const key of ["CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "PLATFORM_E2E_PORTS"]) delete environment[key];
  const preflight = (extra: Record<string, string> = {}) => spawnSync(nodeTs, [path.join(root, "platform/tooling/local-fixtures.ts"), "check-launch"], { cwd: project, env: { ...environment, ...extra }, encoding: "utf8" });
  return { home, project, preflight };
}

const managed = { PLATFORM_E2E_PORTS: JSON.stringify({ cloud: 43210, site: 43211 }) };

test("a managed run refuses to attach a fresh checkout to the machine-wide anonymous-agent state", t => {
  // Convex picks "anonymous-agent" for a checkout without state and then prefers an existing
  // ~/.convex/anonymous-convex-backend-state/anonymous-agent over a new project-local one.
  const { preflight } = checkout(t, "anonymous-agent", undefined);
  const result = preflight(managed);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /machine-wide/);
  assert.match(result.stderr, /anonymous-convex-backend-state\/anonymous-agent/);
});

test("a managed run also refuses a checkout already attached to the shared anonymous-agent state", t => {
  const { preflight } = checkout(t, "anonymous-agent", "CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n");
  const result = preflight(managed);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /machine-wide/);
});

test("interactive startup keeps legacy shared state working and says so", t => {
  const { preflight } = checkout(t, "anonymous-agent", undefined);
  const result = preflight();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /machine-wide/);
});

test("project-local state and uniquely named legacy deployments start without warnings", t => {
  const unique = checkout(t, "anonymous-agent-1234", "CONVEX_DEPLOYMENT=anonymous:anonymous-agent-1234\n");
  const legacy = unique.preflight(managed);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(legacy.stderr, "");
  const local = checkout(t, "anonymous-agent", "CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n");
  fs.mkdirSync(path.join(local.project, "packages/backend/.convex/local/default"), { recursive: true });
  fs.writeFileSync(path.join(local.project, "packages/backend/.convex/local/default/config.json"), JSON.stringify({ deploymentName: "anonymous-agent", ports: { cloud: 3210, site: 3211 }, adminKey: "local" }));
  const result = local.preflight(managed);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});
