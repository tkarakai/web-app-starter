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
  const preflight = (extra: Record<string, string> = {}) => spawnSync(nodeTs, [path.join(root, "platform/tooling/local-fixtures.ts"), "check-state"], { cwd: project, env: { ...environment, ...extra }, encoding: "utf8" });
  return { home, project, preflight };
}

const managed = { PLATFORM_E2E_PORTS: JSON.stringify({ cloud: 43210, site: 43211 }) };

/** Another checkout's backend with the legacy database open, as lsof sees it. */
async function holdDatabase(t: TestContext, home: string): Promise<void> {
  const database = path.join(home, ".convex/anonymous-convex-backend-state/anonymous-agent/convex_local_backend.sqlite3");
  fs.writeFileSync(database, "");
  const holder = spawn("sleep", ["60"], { stdio: ["ignore", "ignore", "ignore", fs.openSync(database, "r")] });
  t.after(() => holder.kill());
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnSync("lsof", ["-t", "--", database], { encoding: "utf8" }).stdout.trim()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail("database holder never opened the file");
}

test("a managed run refuses the machine-wide anonymous-agent state while another backend uses it", async t => {
  // Convex picks "anonymous-agent" for a checkout without state and then prefers an existing
  // ~/.convex/anonymous-convex-backend-state/anonymous-agent over a new project-local one.
  for (const env of [undefined, "CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n"]) {
    const { preflight, home } = checkout(t, "anonymous-agent", env);
    await holdDatabase(t, home);
    const result = preflight(managed);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /machine-wide/);
    assert.match(result.stderr, /anonymous-convex-backend-state\/anonymous-agent/);
    assert.match(result.stderr, /using it right now/);
  }
});

test("long-time developers on unused shared legacy state keep running CI, with a warning", t => {
  // A checkout from before project-local state, alone on the machine: refusing it would fail
  // CI=true bun run ci and platform:upgrade verification for a patch release.
  const { preflight } = checkout(t, "anonymous-agent", "CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n");
  const result = preflight(managed);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /^Warning: .*machine-wide/);
});

test("interactive startup keeps unused legacy shared state working, and refuses it while in use", async t => {
  const { preflight, home } = checkout(t, "anonymous-agent", undefined);
  const alone = preflight();
  assert.equal(alone.status, 0, alone.stderr);
  assert.match(alone.stderr, /^Warning: .*machine-wide/);
  await holdDatabase(t, home);
  const shared = preflight();
  assert.notEqual(shared.status, 0, shared.stderr);
  assert.match(shared.stderr, /using it right now/);
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

test("launchers resolve this checkout's Convex state instead of a fixed machine-wide directory", t => {
  for (const script of ["dev-start.sh", "dev-status.sh"]) {
    const source = fs.readFileSync(path.join(root, "platform/tooling", script), "utf8");
    assert.doesNotMatch(source, /(?<![A-Z_])CONVEX_STATE_DIR=/, script);
    const resolver = source.slice(source.indexOf("get_deployment_name() {"), source.indexOf("get_convex_ports() {"));
    assert.match(resolver, /convex_state_dir\(\) \{/, script);
    type Case = { legacy?: string; env?: string; local?: boolean; emptyLegacy?: string; rootEnv?: string; dotEnv?: string; processEnv?: string; expect: "local" | string };
    const cases: Case[] = [
      { legacy: "anonymous-agent-1234", env: "CONVEX_DEPLOYMENT=anonymous:anonymous-agent-1234\n", expect: "anonymous-agent-1234" },
      { legacy: "anonymous-agent", expect: "anonymous-agent" },
      { legacy: "anonymous-agent", env: "CONVEX_DEPLOYMENT=anonymous:unknown\n", expect: "anonymous-agent" },
      { expect: "local" },
      { legacy: "anonymous-agent", env: "CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n", local: true, expect: "local" },
      // The CLI ignores a legacy directory without config.json and falls back to the agent default.
      { legacy: "anonymous-agent", env: "CONVEX_DEPLOYMENT=anonymous:anonymous-old\n", emptyLegacy: "anonymous-old", expect: "anonymous-agent" },
      // ...and reads only the backend's .env.local.
      { legacy: "anonymous-agent-9", rootEnv: "CONVEX_DEPLOYMENT=anonymous:anonymous-agent-9\n", expect: "local" },
      // ...but takes the environment first and the backend's .env last.
      { legacy: "anonymous-agent-7", processEnv: "anonymous:anonymous-agent-7", env: "CONVEX_DEPLOYMENT=anonymous:unknown\n", expect: "anonymous-agent-7" },
      { legacy: "anonymous-agent-8", dotEnv: "CONVEX_DEPLOYMENT=anonymous:anonymous-agent-8\n", expect: "anonymous-agent-8" },
      // The agent default needs only its directory, even an interrupted one without config.json.
      { emptyLegacy: "anonymous-agent", expect: "anonymous-agent" },
      // An exported empty value hides the files, as it does for the CLI; quotes and CRLF are parsed.
      { legacy: "anonymous-agent-5", env: "CONVEX_DEPLOYMENT=anonymous:anonymous-agent-5\n", processEnv: "", expect: "local" },
      { legacy: "anonymous-agent-6", env: "CONVEX_DEPLOYMENT=\"anonymous:anonymous-agent-6\"\r\n", expect: "anonymous-agent-6" },
    ];
    for (const { legacy, env, local, emptyLegacy, rootEnv, dotEnv, processEnv, expect } of cases) {
      const { project, home } = checkout(t, legacy, env);
      if (local) {
        fs.mkdirSync(path.join(project, "packages/backend/.convex/local/default"), { recursive: true });
        fs.writeFileSync(path.join(project, "packages/backend/.convex/local/default/config.json"), "{}");
      }
      if (emptyLegacy) fs.mkdirSync(path.join(home, ".convex/anonymous-convex-backend-state", emptyLegacy), { recursive: true });
      if (rootEnv) fs.writeFileSync(path.join(project, ".env.local"), rootEnv);
      if (dotEnv) fs.writeFileSync(path.join(project, "packages/backend/.env"), dotEnv);
      const environment: Record<string, string | undefined> = { ...process.env, HOME: home, CONVEX_DEPLOYMENT: processEnv };
      if (processEnv === undefined) delete environment.CONVEX_DEPLOYMENT;
      const typescript = spawnSync(nodeTs, [path.join(root, "platform/tooling/local-fixtures.ts"), "state-dir"], { cwd: project, env: environment, encoding: "utf8" }).stdout.trim();
      const shell = spawnSync("bash", ["-c", `PROJECT_DIR=${JSON.stringify(project)}\n${resolver}\nconvex_state_dir`], { env: environment, encoding: "utf8" }).stdout.trim();
      assert.equal(shell, typescript, `${script}: ${JSON.stringify({ legacy, env, local, emptyLegacy, rootEnv, dotEnv, processEnv })}`);
      assert.equal(typescript, expect === "local" ? path.join(project, "packages/backend/.convex/local/default") : path.join(home, ".convex/anonymous-convex-backend-state", expect));
    }
  }
});

test("Convex startups from different checkouts take turns, and an exited holder never blocks", async t => {
  const leases = leaseDirectory(t);
  const environment = { ...process.env, PLATFORM_PORT_LEASE_DIR: leases };
  const lock = (owner: number, timeout = "1") => spawnSync(nodeTs, [path.join(root, "platform/tooling/local-ports.ts"), "lock", "convex-start", String(owner), timeout], { env: environment, encoding: "utf8" });
  const holder = spawn("sleep", ["30"]);
  t.after(() => holder.kill());
  const contender = spawn("sleep", ["30"]);
  t.after(() => contender.kill());
  assert.equal(lock(holder.pid!).stderr, "");
  const blocked = lock(contender.pid!);
  assert.match(blocked.stderr, /Waiting for another checkout/);
  assert.match(blocked.stderr, /continuing without the lock/);
  spawnSync(nodeTs, [path.join(root, "platform/tooling/local-ports.ts"), "unlock", "convex-start", String(holder.pid)], { env: environment });
  assert.equal(lock(contender.pid!).stderr, "");
  contender.kill();
  await once(contender, "exit");
  // The contender exited while holding the lock: the next startup reclaims it at once.
  assert.equal(lock(holder.pid!).stderr, "");
});

test("the next ordinary start restores the backend ports a SIGKILLed managed run left behind", t => {
  // Playwright SIGKILLs its webServer group, so dev-start's exit trap never restores them.
  const source = fs.readFileSync(path.join(root, "platform/tooling/dev-start.sh"), "utf8");
  const helpers = source.slice(source.indexOf("get_deployment_name() {"), source.indexOf("get_convex_ports() {"));
  assert.match(source, /if \[ -z "\$\{PLATFORM_E2E_PORTS:-\}" \]; then\n\s+restore_saved_backend_ports\n\s+fi/);
  // The shared-state check and the restore run under the startup lock, never before it.
  const locked = source.indexOf("local-ports.ts\" lock convex-start");
  assert.ok(source.indexOf("local-fixtures.ts\" check-state") > locked);
  assert.ok(source.indexOf("        restore_saved_backend_ports\n") > source.indexOf("local-fixtures.ts\" check-state"));
  // The state directory is fixed before anything can exit through the trap's restore.
  assert.ok(source.indexOf("PLATFORM_CONVEX_STATE_DIR=$(convex_state_dir)") < source.indexOf("check_esbuild)"));
  const { project } = checkout(t, undefined, undefined);
  const state = path.join(project, "packages/backend/.convex");
  fs.mkdirSync(path.join(state, "local/default"), { recursive: true });
  fs.writeFileSync(path.join(state, "local/default/config.json"), JSON.stringify({ deploymentName: "anonymous-agent", adminKey: "local", ports: { cloud: 58001, site: 58002 } }));
  fs.writeFileSync(path.join(state, "platform-e2e-saved-ports.json"), JSON.stringify({ cloud: 3210, site: 3211 }));
  const tooling = path.join(root, "platform/tooling");
  const result = spawnSync("bash", ["-c", `PROJECT_DIR=${JSON.stringify(project)}; SCRIPT_DIR=${JSON.stringify(tooling)}; NODE_TS="$SCRIPT_DIR/node-ts.sh"\n${helpers}\nrestore_saved_backend_ports`], { encoding: "utf8", env: { ...process.env, HOME: path.join(path.dirname(project), "home") } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, "local/default/config.json"), "utf8")).ports, { cloud: 3210, site: 3211 });
  assert.equal(fs.existsSync(path.join(state, "platform-e2e-saved-ports.json")), false);
});

test("an unusable lease directory degrades to uncoordinated ports instead of failing", t => {
  const blocked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "leases-")), "file");
  t.after(() => fs.rmSync(path.dirname(blocked), { recursive: true, force: true }));
  fs.writeFileSync(blocked, "");
  const environment = { ...process.env, PLATFORM_PORT_LEASE_DIR: blocked };
  const claim = spawnSync(nodeTs, [path.join(root, "platform/tooling/local-ports.ts"), "claim", "port-43002", String(process.pid)], { env: environment, encoding: "utf8" });
  assert.equal(claim.status, 2, claim.stderr);
  const script = `import { reservePorts } from ${JSON.stringify(path.join(root, "platform/tooling/local-ports.ts"))};
process.stdout.write(JSON.stringify(reservePorts(["web", "cloud"]).ports));`;
  const reserved = spawnSync(nodeTs, ["--input-type=module", "-e", script], { env: environment, encoding: "utf8" });
  assert.equal(reserved.status, 0, reserved.stderr);
  assert.equal(Object.keys(JSON.parse(reserved.stdout) as object).length, 2);
});

test("a managed run on legacy state stages and restores that legacy config, not a project-local one", async t => {
  const { prepareBackendPorts, restoreBackendPorts } = await import("../e2e-ports.ts");
  const { project, home } = checkout(t, "anonymous-agent", undefined);
  const backend = path.join(project, "packages/backend");
  const legacyConfig = path.join(home, ".convex/anonymous-convex-backend-state/anonymous-agent/config.json");
  const previous = process.env.PLATFORM_E2E_PORTS;
  process.env.PLATFORM_E2E_PORTS = JSON.stringify({ cloud: 58101, site: 58102 });
  try {
    prepareBackendPorts(backend, path.dirname(legacyConfig));
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyConfig, "utf8")).ports, { cloud: 58101, site: 58102 });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backend, ".convex/platform-e2e-saved-ports.json"), "utf8")), { cloud: 3210, site: 3211 });
    restoreBackendPorts(backend, path.dirname(legacyConfig));
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyConfig, "utf8")).ports, { cloud: 3210, site: 3211 });
    // An unreadable record is dropped instead of failing every later start.
    fs.writeFileSync(path.join(backend, ".convex/platform-e2e-saved-ports.json"), "");
    restoreBackendPorts(backend, path.dirname(legacyConfig));
    assert.equal(fs.existsSync(path.join(backend, ".convex/platform-e2e-saved-ports.json")), false);
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_E2E_PORTS;
    else process.env.PLATFORM_E2E_PORTS = previous;
  }
});

test("a held port has its own exit status, distinct from a crash", t => {
  const leases = leaseDirectory(t);
  const environment = { ...process.env, PLATFORM_PORT_LEASE_DIR: leases };
  const holder = spawn("sleep", ["30"]);
  t.after(() => holder.kill());
  const claim = (owner: number) => spawnSync(nodeTs, [path.join(root, "platform/tooling/local-ports.ts"), "claim", "port-43002", String(owner)], { env: environment, encoding: "utf8" });
  assert.equal(claim(holder.pid!).status, 0);
  assert.equal(claim(process.pid).status, 3);
});

test("a managed run's apps get its planned backend URLs, never stale exported ones", () => {
  // Next prefers the process environment over .env.local, so an exported CONVEX_URL (a shell
  // profile, a CI or lab harness, the old 3210/3211 defaults) pointed the apps elsewhere.
  const source = fs.readFileSync(path.join(root, "platform/tooling/dev-start.sh"), "utf8");
  const start = source.indexOf("export_managed_backend_urls() {");
  assert.ok(start > 0, "dev-start.sh defines export_managed_backend_urls");
  const helper = source.slice(start, source.indexOf("\n}\n", start) + 3);
  const call = source.search(/\n\s+export_managed_backend_urls\n/);
  assert.ok(call > 0 && call < source.indexOf('start_next_app "$app_name"'), "called before any Next app starts");
  const run = (plan: string | undefined) => {
    const env: Record<string, string | undefined> = { ...process.env, CONVEX_URL: "http://127.0.0.1:3210", CONVEX_SITE_URL: "http://127.0.0.1:3211", NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3211", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210" };
    if (plan === undefined) delete env.PLATFORM_E2E_PORTS; else env.PLATFORM_E2E_PORTS = plan;
    return spawnSync("bash", ["-c", `${helper}\nCLOUD_PORT=58301; SITE_PORT=58302\nexport_managed_backend_urls\nprintf '%s %s %s %s' "$CONVEX_URL" "$CONVEX_SITE_URL" "$NEXT_PUBLIC_CONVEX_SITE_URL" "$NEXT_PUBLIC_CONVEX_URL"`], { encoding: "utf8", env }).stdout;
  };
  assert.equal(run(JSON.stringify({ cloud: 58301, site: 58302 })), "http://127.0.0.1:58301 http://127.0.0.1:58302 http://127.0.0.1:58302 http://127.0.0.1:58301");
  // Interactive dev keeps whatever the developer exported.
  assert.equal(run(undefined), "http://127.0.0.1:3210 http://127.0.0.1:3211 http://127.0.0.1:3211 http://127.0.0.1:3210");
});

test("a stale claim whose PID was reused by an unrelated process is reclaimed", async t => {
  const leases = leaseDirectory(t);
  const unrelated = spawn("sleep", ["30"]);
  t.after(() => unrelated.kill());
  await once(unrelated, "spawn");
  const environment = { ...process.env, PLATFORM_PORT_LEASE_DIR: leases };
  const claim = (owner: number) => spawnSync(nodeTs, [path.join(root, "platform/tooling/local-ports.ts"), "claim", "port-43002", String(owner)], { env: environment, encoding: "utf8" });
  // A launcher that died long ago left this claim; its PID now belongs to `sleep`.
  fs.writeFileSync(path.join(leases, `port-43002.${unrelated.pid}.deadbeef0000`), "Mon Jan  1 00:00:00 2001\n");
  assert.equal(claim(process.pid).status, 0, "a claim whose recorded owner start differs is stale");
  // A live owner's claim records its own start time and keeps blocking others.
  fs.rmSync(leases, { recursive: true, force: true });
  fs.mkdirSync(leases, { mode: 0o700 });
  assert.equal(claim(unrelated.pid!).status, 0);
  assert.notEqual(fs.readFileSync(path.join(leases, fs.readdirSync(leases)[0]), "utf8").trim(), "", "claims record their owner's start");
  assert.equal(claim(process.pid).status, 3);
  // A claim from an older launcher records no start time: kept while its PID is alive.
  fs.rmSync(leases, { recursive: true, force: true });
  fs.mkdirSync(leases, { mode: 0o700 });
  fs.writeFileSync(path.join(leases, `port-43002.${unrelated.pid}.cafecafe0000`), "");
  assert.equal(claim(process.pid).status, 3);
});
