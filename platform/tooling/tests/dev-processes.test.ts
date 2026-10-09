/**
 * Run with: bun run test:dev-scripts
 *
 * Real disposable processes and checkouts exercise ownership without touching
 * running development services or Convex databases.
 */
import { afterEach, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import mutableFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as path from "node:path";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as manager from "../dev-processes.ts";
import rawAppConfig from "../../../app.config.ts";
import { copyConfiguredIcons } from "./icon-fixture.ts";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(SCRIPTS, "../..");
const INSTALLED = ["package.json", "node-ts.sh", "dev-processes.ts", "dev-dashboard.sh", "dev-start.sh", "dev-convex.sh", "dev-stop.sh", "dev-stop-convex.sh", "dev-nuke-all.sh", "dev-status.sh", "app-config.ts", "next-dev.sh", "local-fixtures.ts", "ensure-local-deps.sh", "ensure-app-env.sh", "http-ready.ts", "local-dev-deps.ts"];
// The dev scripts read ports from app.config.ts through platform/tooling/app-config.ts.
const CONFIG_FILES = ["app.config.ts", "platform/packages/app-config/src/schema.ts", ".github/actions/deploy-convex/fixture-target.ts", ".github/actions/deploy-convex/organization-target.ts"];

let temp: string, base: string, root: string, foreign: string, processes: ChildProcess[];

function install(checkout: string): void {
  fs.mkdirSync(path.join(checkout, "platform/tooling"), { recursive: true });
  for (const name of INSTALLED) fs.copyFileSync(path.join(SCRIPTS, name), path.join(checkout, "platform/tooling", name));
  for (const name of CONFIG_FILES) {
    fs.mkdirSync(path.dirname(path.join(checkout, name)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, name), path.join(checkout, name));
  }
  for (const [name, source] of Object.entries({next: "const {createServer}=require('node:http');const server=createServer((req,res)=>res.end('fixture'));server.listen(Number(process.argv[process.argv.indexOf('--port')+1]),()=>{console.log('Local: http://localhost:'+server.address().port);console.log('Ready in 1ms');});", convex: "console.log('fixture');"})) {
    const pkg = path.join(checkout, "packages", name);
    fs.mkdirSync(pkg, {recursive:true});
    fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({name,version:"0.0.0",bin:{[name]:"fixture.cjs"}}));
    fs.writeFileSync(path.join(pkg,"fixture.cjs"),source);
  }
  fs.mkdirSync(path.join(checkout,"packages/backend"),{recursive:true});
  fs.writeFileSync(path.join(checkout,"packages/backend/package.json"),'{"name":"@repo/backend","dependencies":{"convex":"workspace:*"}}');
  fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ private: true, type: "module", workspaces:["packages/*"], dependencies:{next:"workspace:*",convex:"workspace:*"} }));
  execFileSync("bun", ["install"], {cwd:checkout,stdio:"pipe"});
}

function installPredev(checkout: string, source = ROOT): void {
  const original = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ private: true, type: "module", scripts: original.scripts, packageManager: original.packageManager, workspaces: ["apps/*", "platform/apps/*", "packages/*"], dependencies: {next:"workspace:*",convex:"workspace:*"} }));
  const manifest = JSON.parse(fs.readFileSync(path.join(checkout, "package.json"), "utf8"));
  delete manifest.scripts.postinstall;
  fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify(manifest));
  for (const name of ["ensure-local-deps.sh", "ensure-app-env.sh", "copy-shared-assets.sh"]) {
    fs.copyFileSync(path.join(SCRIPTS, name), path.join(checkout, "platform/tooling", name));
  }
  copyConfiguredIcons(checkout, source);
}

function spawnIn(directory: string, source?: string): ChildProcess {
  const command = source === undefined
    ? ["bash", ["-c", "exec -a convex-local-backend sleep 300"]] as const
    : [process.execPath, ["-e", source]] as const;
  const child = spawn(command[0], [...command[1]], { cwd: directory, detached: true, stdio: "ignore" });
  processes.push(child);
  return child;
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function alive(child: ChildProcess): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return !exited(child);
}

function runScript(name: string, args: string[] = [], checkout = root, env = process.env): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [path.join(checkout, "platform/tooling", name), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

function track(name: string, child: ChildProcess, checkout = root): void {
  manager.track(checkout, name, child.pid as number);
  fs.appendFileSync(path.join(checkout, ".dev-pids"), `${name}:${child.pid}\n`);
}

test("status finds live ownership when the legacy PID file is missing", async () => {
  const child = spawnIn(root);
  await waitFor(() => Boolean(manager.identity(child.pid!)));
  track("convex", child);
  fs.unlinkSync(path.join(root, ".dev-pids"));
  const status = await runScript("dev-status.sh");
  assert.match(stripAnsi(status.stdout), /Convex API\s+up/);
  manager.stop(root);
  assert.equal(await alive(child), false);
  assert.deepEqual(manager.readRecords(root), {});
});

test("registration failure stops only the newly launched process and keeps earlier ownership", async () => {
  const existing = spawnIn(root), fresh = spawnIn(root), unrelated = spawnIn(foreign);
  await waitFor(() => Boolean(manager.identity(fresh.pid!)));
  track("existing", existing);
  const rename = mock.method(mutableFs, "renameSync", () => { throw new Error("fixture registration failure"); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => manager.track(root, "fresh", fresh.pid!), /fixture registration failure/);
  } finally {
    rename.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(await alive(fresh), false);
  assert.equal(await alive(existing), true);
  assert.equal(await alive(unrelated), true);
  assert.deepEqual(Object.keys(manager.readRecords(root)), ["existing"]);
});

test("a process surviving termination retains its authoritative and legacy records", async () => {
  const child = spawnIn(root);
  await waitFor(() => Boolean(manager.identity(child.pid!)));
  track("convex", child);
  const kill = mock.method(process, "kill", () => true);
  try { assert.throws(() => manager.stop(root), /survived termination/); } finally { kill.mock.restore(); }
  assert.equal(await alive(child), true);
  assert.equal(manager.readRecords(root).convex.pid, child.pid);
  assert.match(fs.readFileSync(path.join(root, ".dev-pids"), "utf8"), /convex:/);
  manager.stop(root);
  assert.equal(await alive(child), false);
});

test("surviving descendants remain discoverable after their launcher exits", async () => {
  const parent = spawnIn(root, "const {spawn}=require('node:child_process'); const fs=require('node:fs'); "
    + "const children=[spawn('sleep',['300'],{stdio:'ignore'}),spawn('sleep',['300'],{stdio:'ignore'})]; "
    + "fs.writeFileSync('children.json',JSON.stringify(children.map(p=>p.pid))); setInterval(()=>{},1000);");
  await waitFor(() => fs.existsSync(path.join(root, "children.json")));
  const children = JSON.parse(fs.readFileSync(path.join(root, "children.json"), "utf8")) as number[];
  track("convex", parent);
  const originalKill = process.kill.bind(process);
  const kill = mock.method(process, "kill", (pid: number, signal?: Parameters<typeof process.kill>[1]) => {
    if (children.includes(pid)) return true;
    return originalKill(pid, signal);
  });
  try { assert.throws(() => manager.stop(root), /survived termination/); } finally { kill.mock.restore(); }
  await waitFor(() => exited(parent));
  const record = manager.readRecords(root).convex;
  assert.deepEqual(new Set([record.pid, ...(record.owned ?? []).map(owner => owner.pid)]), new Set(children));
  fs.unlinkSync(path.join(root, ".dev-pids"));
  const status = await runScript("dev-status.sh");
  assert.equal(status.status, 0, status.stderr);
  assert.match(stripAnsi(status.stdout), /Convex API\s+up/);
  for (const pid of children) assert.equal(manager.main(["--root", root, "running", "convex", String(pid)]), 0);
  const fresh = spawnIn(root);
  await waitFor(() => Boolean(manager.identity(fresh.pid!)));
  assert.throws(() => manager.track(root, "convex", fresh.pid!), /Cannot replace live ownership/);
  assert.equal(await alive(fresh), false);
  assert.equal((await runScript("dev-stop.sh")).status, 0);
  for (const pid of children) assert.equal(manager.identity(pid), "");
  assert.deepEqual(manager.readRecords(root), {});
});

for (const descendant of [false, true]) test(`registration failure persists surviving ${descendant ? "descendants" : "launchers"} without losing earlier ownership`, async () => {
  const existing = spawnIn(root), fresh = spawnIn(root, descendant
    ? "const p=require('node:child_process').spawn('sleep',['300'],{stdio:'ignore'}); require('node:fs').writeFileSync('child.pid',String(p.pid)); setInterval(()=>{},1000);"
    : undefined);
  await waitFor(() => Boolean(manager.identity(fresh.pid!)));
  if (descendant) await waitFor(() => fs.existsSync(path.join(root, "child.pid")));
  const survivor = descendant ? Number(fs.readFileSync(path.join(root, "child.pid"), "utf8")) : fresh.pid!;
  track("existing", existing);
  const originalRename = mutableFs.renameSync;
  let fail = true;
  const rename = mock.method(mutableFs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
    if (fail) { fail = false; throw new Error("fixture registration failure"); }
    return originalRename(...args);
  });
  const originalKill = process.kill.bind(process);
  const kill = mock.method(process, "kill", (pid: number, signal?: Parameters<typeof process.kill>[1]) => pid === survivor ? true : originalKill(pid, signal));
  syncBuiltinESMExports();
  try {
    assert.throws(() => manager.track(root, "fresh", fresh.pid!), /fixture registration failure/);
  } finally {
    rename.mock.restore(); kill.mock.restore(); syncBuiltinESMExports();
  }
  assert.equal(manager.readRecords(root).fresh.pid, survivor);
  assert.equal(manager.readRecords(root).existing.pid, existing.pid);
  fs.unlinkSync(path.join(root, ".dev-pids"));
  assert.equal(manager.main(["--root", root, "running", "fresh", String(survivor)]), 0);
  manager.stop(root);
  assert.equal(manager.identity(survivor), "");
  assert.equal(await alive(fresh), false);
  assert.equal(await alive(existing), false);
});

test("stop waits for forced termination before dropping ownership", async () => {
  const child = spawnIn(root, "process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync('ready',''); setInterval(()=>{},1000);");
  await waitFor(() => fs.existsSync(path.join(root, "ready")));
  track("convex", child);
  manager.stop(root);
  assert.equal(manager.identity(child.pid!), "");
  assert.deepEqual(manager.readRecords(root), {});
});

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for disposable process");
}

test("default startup skips stripped apps and explicit missing apps fail before side effects", async () => {
  fs.mkdirSync(path.join(root, "platform/apps/storybook"), { recursive: true });
  fs.writeFileSync(path.join(root, "platform/apps/storybook/package.json"), "{}");
  // Stop at the first setup operation, after exercising the real app checks and config reader.
  fs.writeFileSync(path.join(root, "platform/tooling/copy-shared-assets.sh"), "#!/bin/bash\nexit 17\n", { mode: 0o755 });
  const selected = await runScript("dev-start.sh", ["--ci"]);
  assert.equal(selected.status, 1, selected.stderr);
  assert.match(stripAnsi(selected.stdout), /App is not installed: landing/);
  assert.equal(fs.existsSync(path.join(root, "apps/landing")), false);
  const missing = await runScript("dev-start.sh", ["--ci", "--app=landing"]);
  assert.equal(missing.status, 1); assert.match(missing.stdout, /App is not installed: landing/);
  assert.equal(fs.existsSync(path.join(root, ".dev-pids")), false);
});

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(ROOT, ".dev-process-test-"));
  base = fs.realpathSync(temp);
  root = path.join(base, "client");
  foreign = path.join(base, "client-other"); // Prefix matches must not count.
  processes = [];
  install(root);
  fs.mkdirSync(foreign);
});

afterEach(async () => {
  // Stop recorded descendants even if a fixture launcher failed early.
  try {
    manager.stop(root);
  } catch {
    // Invalid records are part of some fixtures.
  }
  for (const child of processes.reverse()) {
    if (!exited(child)) {
      const closed = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await closed;
    }
  }
  fs.rmSync(temp, { recursive: true, force: true });
});

for (const scenario of [
  { label: "current dashboard URL without a startup log", url: "http://127.0.0.1:6790/", code: "0" },
  { label: "an alternate dashboard port", url: "http://127.0.0.1:6792/", code: "0" },
  { label: "an unavailable dashboard", url: "", code: "0" },
  { label: "a failed dashboard lookup", url: "", code: "1" },
]) {
  test(`status handles ${scenario.label}`, async () => {
    const backend = path.join(root, "packages/backend");
    fs.mkdirSync(backend, { recursive: true });
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const invocation = path.join(root, "dashboard-command");
    fs.writeFileSync(path.join(root, "packages/convex/fixture.cjs"), `
const fs = require('node:fs');
fs.writeFileSync(process.env.DASHBOARD_TEST_INVOCATION, [process.cwd(), ...process.argv.slice(2)].join('\\n') + '\\n');
console.log(process.env.DASHBOARD_TEST_URL);
console.error('diagnostic output');
process.exit(Number(process.env.DASHBOARD_TEST_CODE));
`);
    fs.writeFileSync(path.join(bin, "bunx"), "#!/bin/bash\nexit 99\n", { mode: 0o755 });
    const convex = spawnIn(root);
    track("convex", convex);
    const result = await runScript("dev-status.sh", [], root, {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      DASHBOARD_TEST_INVOCATION: invocation,
      DASHBOARD_TEST_URL: scenario.url,
      DASHBOARD_TEST_CODE: scenario.code,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(fs.readFileSync(invocation, "utf8"), `${backend}\ndashboard\n--no-open\n`);
    if (scenario.url) {
      assert.ok(result.stdout.includes("Convex UI"));
      assert.ok(result.stdout.includes(scenario.url));
    } else {
      assert.ok(!result.stdout.includes("Convex UI"));
    }
    assert.ok(!result.stdout.includes("diagnostic output"));
  });
}

for (const dependency of ["missing", "ancestor", "external-link"]) {
  test(`status rejects ${dependency} Convex dependencies without invoking fallback executables`, async () => {
    const convex = spawnIn(root);
    await waitFor(() => Boolean(manager.identity(convex.pid!)));
    track("convex", convex);
    fs.rmSync(path.join(root, "node_modules"), { recursive: true, force: true });
    fs.rmSync(path.join(root, "packages/backend/node_modules"), { recursive: true, force: true });
    const marker = path.join(root, "fallback-invoked");
    const outside = path.join(base, "node_modules/convex");
    fs.mkdirSync(outside, { recursive: true });
    const forbidden = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`;
    if (dependency !== "missing") {
      fs.writeFileSync(path.join(outside, "package.json"), '{"name":"convex","bin":"cli.cjs"}');
      fs.writeFileSync(path.join(outside, "cli.cjs"), forbidden);
    }
    if (dependency === "external-link") {
      fs.mkdirSync(path.join(root, "node_modules"));
      fs.symlinkSync(outside, path.join(root, "node_modules/convex"));
    }
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    for (const name of ["bunx", "convex"]) fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env node\n${forbidden}`, { mode: 0o755 });
    const result = await runScript("dev-status.sh", [], root, { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Development dependencies:/);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(await alive(convex), true);
  });
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI, "");

// Return each status row as [service, status, url, pid], split at the header column offsets.
function statusColumns(stdout: string): { header: number[]; rows: string[][] } {
  const lines = stripAnsi(stdout).split("\n").filter((line) => line.startsWith("  ") && line.trim() !== "");
  const headerLine = lines.find((line) => line.includes("SERVICE")) as string;
  const header = ["SERVICE", "STATUS", "URL", "PID"].map((title) => headerLine.indexOf(title));
  const rows = lines.filter((line) => /\bup\b|\bdead\b|\bhttp:/.test(line) && !line.includes("SERVICE") && !line.includes("Stop with")).map((line) =>
    header.map((start, index) => line.slice(start, header[index + 1] ?? line.length).trim()));
  return { header, rows };
}

test("status sizes its columns to the longest service name and keeps rows aligned", async () => {
  fs.mkdirSync(path.join(root, "packages/backend"), { recursive: true });
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, "packages/convex/fixture.cjs"), "console.log('http://127.0.0.1:6790/');\n");
  for (const [name, port] of [["landing", 3000], ["web", 3001]] as const) {
    track(`next-${name}`, spawnIn(root));
    fs.writeFileSync(path.join(root, `.next-${name}.log`), `ready on http://localhost:${port}\n`);
  }
  track("convex", spawnIn(root));
  const result = await runScript("dev-status.sh", [], root, { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  assert.equal(result.status, 0, result.stderr);
  const plain = stripAnsi(result.stdout);
  const { header, rows } = statusColumns(result.stdout);
  const byService = Object.fromEntries(rows.map((row) => [row[0], row]));
  assert.deepEqual(byService.Landing.slice(1, 3), ["up", "http://localhost:3000"]);
  assert.deepEqual(byService.Web.slice(1, 3), ["up", "http://localhost:3001"]);
  assert.equal(byService["Convex UI"][1], "");
  assert.equal(byService["Convex UI"][2], "http://127.0.0.1:6790/");
  // Every value starts exactly where its header does, including rows with blank fields.
  for (const line of plain.split("\n")) {
    const service = ["Landing", "Web", "Convex API", "Site API", "Convex UI"].find((name) => line.startsWith(`  ${name}`));
    if (service === undefined) continue;
    assert.equal(line.slice(header[0] - 2, header[0]).trim(), "", line);
    assert.ok(line.slice(header[0], header[1]).trim() === service, `service column overflows: ${line}`);
    assert.match(line.slice(header[1] - 2, header[1]), /^ {2}$/, line);
    if (line.slice(header[1], header[2]).trim() !== "") assert.match(line.slice(header[1], header[2]), /^(up|dead) +$/, line);
  }
  assert.match(plain, /^ {2}─+ {2}─{6} {2}─+ {2}─{5}$/m);
});

test("stop owned tree preserves unrelated backend", async () => {
  const outsider = spawnIn(foreign);
  const parent = spawnIn(root, "const { spawn } = require('node:child_process'); const fs = require('node:fs'); "
    + "const p = spawn('sleep', ['300'], { stdio: 'ignore' }); fs.writeFileSync('child.pid', String(p.pid)); setTimeout(() => {}, 300000);");
  const childFile = path.join(root, "child.pid");
  await waitFor(() => fs.existsSync(childFile));
  track("convex", parent);
  const child = Number(fs.readFileSync(childFile, "utf8"));
  const result = await runScript("dev-stop.sh");
  assert.equal(result.status, 0, result.stderr);
  await waitFor(() => exited(parent));
  await waitFor(() => !manager.identity(child));
  assert.ok(await alive(outsider));
});

test("convex-only stop preserves next and foreign backend", async () => {
  const convex = spawnIn(root);
  const web = spawnIn(root);
  const outsider = spawnIn(foreign);
  track("convex", convex);
  track("next-web", web);
  const result = await runScript("dev-stop-convex.sh");
  assert.equal(result.status, 0, result.stderr);
  await waitFor(() => exited(convex));
  assert.ok(await alive(web));
  assert.ok(await alive(outsider));
  assert.equal(fs.readFileSync(path.join(root, ".dev-pids"), "utf8"), `next-web:${web.pid}\n`);
  assert.deepEqual(Object.keys(manager.readRecords(root)), ["next-web"]);
});

test("stale identity and foreign pid are never signalled", async () => {
  const local = spawnIn(root);
  const outsider = spawnIn(foreign);
  await waitFor(() => Boolean(manager.identity(outsider.pid as number)));
  manager.writeRecords(root, {
    convex: { pid: outsider.pid as number, started: manager.identity(outsider.pid as number) },
    "next-web": { pid: local.pid as number, started: "old process start identity" },
  });
  const result = await runScript("dev-stop.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(await alive(local));
  assert.ok(await alive(outsider));
});

test("legacy pid without identity is not authority", async () => {
  const outsider = spawnIn(foreign);
  fs.writeFileSync(path.join(root, ".dev-pids"), `convex:${outsider.pid}\n`);
  const result = await runScript("dev-stop.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ignoring legacy/);
  assert.ok(await alive(outsider));
});

test("missing legacy PID file needs no cleanup", () => {
  manager.stop(root);
  assert.equal(fs.existsSync(path.join(root, ".dev-pids")), false);
});

test("stopping all services leaves an empty legacy file", () => {
  const legacy = path.join(root, ".dev-pids");
  fs.writeFileSync(legacy, "convex:123\n");
  manager.stop(root);
  assert.equal(fs.readFileSync(legacy, "utf8"), "");
});

for (const link of ["symlink", "hardlink"] as const) {
  test(`legacy ${link} cannot overwrite another checkout's file`, () => {
    const victim = path.join(foreign, "pids");
    fs.writeFileSync(victim, "convex:123\nnext-web:456\n");
    const legacy = path.join(root, ".dev-pids");
    if (link === "symlink") fs.symlinkSync(victim, legacy);
    else fs.linkSync(victim, legacy);
    assert.throws(() => manager.stop(root, "convex"));
    assert.equal(fs.readFileSync(victim, "utf8"), "convex:123\nnext-web:456\n");
  });
}

function readRegularFile(file: string): string {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    assert.ok(fs.fstatSync(fd).isFile(), "the observed file is regular");
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// Replace the path after the real read. The stop operation must only update
// the file it opened, never a new entry or a symlink's target at the old path.
for (const replacement of ["file", "symlink", "missing"] as const) {
  for (const name of [undefined, "convex"]) {
    test(`legacy ${name ?? "all"} cleanup tolerates path replacement: ${replacement}`, () => {
      const legacy = path.join(root, ".dev-pids");
      const original = path.join(root, "original-pids");
      const victim = path.join(foreign, "pids");
      const fixture = fs.openSync(legacy, "wx+");
      let inode: number;
      try {
        fs.writeFileSync(fixture, "convex:123\nnext-web:456\n");
        inode = fs.fstatSync(fixture).ino;
      } finally {
        fs.closeSync(fixture);
      }
      fs.writeFileSync(victim, "keep foreign data\n");
      let replaced = false;
      const reader = mock.method(mutableFs, "readFileSync", new Proxy(mutableFs.readFileSync, {
        apply(target, thisArg, args: Parameters<typeof fs.readFileSync>) {
          const result = Reflect.apply(target, thisArg, args) as ReturnType<typeof fs.readFileSync>;
          const file = args[0];
          if (!replaced && (file === legacy || (typeof file === "number" && fs.fstatSync(file).ino === inode))) {
            replaced = true;
            fs.renameSync(legacy, original);
            if (replacement === "file") fs.writeFileSync(legacy, "keep replacement data\n");
            if (replacement === "symlink") fs.symlinkSync(victim, legacy);
          }
          return result;
        },
      }));
      syncBuiltinESMExports();
      try {
        manager.stop(root, name);
      } finally {
        reader.mock.restore();
        syncBuiltinESMExports();
      }
      assert.ok(replaced, "the path was replaced during cleanup");
      assert.equal(readRegularFile(victim), "keep foreign data\n");
      if (replacement === "file") assert.equal(readRegularFile(legacy), "keep replacement data\n");
      if (replacement === "symlink") assert.equal(fs.readlinkSync(legacy), victim);
      if (replacement === "missing") assert.equal(fs.existsSync(legacy), false);
      assert.equal(readRegularFile(original), name === undefined ? "" : "next-web:456\n");
    });
  }
}

test("legacy directories are rejected", () => {
  fs.mkdirSync(path.join(root, ".dev-pids"));
  assert.throws(() => manager.stop(root));
});

test("copied records are refused and stop nothing", async () => {
  const owned = spawnIn(root);
  track("convex", owned);
  const file = path.join(root, ".dev-processes.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { root: string };
  data.root = foreign;
  fs.writeFileSync(file, JSON.stringify(data));
  const result = await runScript("dev-stop.sh");
  assert.notEqual(result.status, 0);
  assert.ok(await alive(owned));
});

test("noninteractive start, restart and exit preserve foreign backend", async () => {
  const outsider = spawnIn(foreign);
  const previous = spawnIn(root);
  track("next-storybook", previous);
  fs.unlinkSync(path.join(root, ".dev-pids"));
  fs.mkdirSync(path.join(root, "platform/apps/storybook"), { recursive: true });
  fs.writeFileSync(path.join(root,"platform/apps/storybook/package.json"),'{"name":"@repo/storybook"}');
  fs.writeFileSync(path.join(root, "platform/tooling/copy-shared-assets.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const bindir = path.join(root, "fake-bin");
  fs.mkdirSync(bindir);
  const fakes: Record<string, string> = {
    bun: "#!/bin/sh\necho 1.3.9\n",
    bunx: "#!/usr/bin/env node\nconst {createServer} = await import('node:http'); const server = createServer((req,res)=>res.end('fixture')); server.listen(0,()=>{console.log('Local: http://localhost:'+server.address().port);console.log('Ready in 1ms');});\n",
  };
  for (const [name, content] of Object.entries(fakes)) fs.writeFileSync(path.join(bindir, name), content, { mode: 0o755 });
  const log = path.join(root, "start.log");
  const output = fs.openSync(log, "w");
  const launcher = spawn("bash", [path.join(root, "platform/tooling/dev-start.sh"), "--ci", "--app=storybook"], {
    cwd: root, env: { ...process.env, CONVEX_LOCAL_BACKEND_VERSION: undefined, PATH: bindir + path.delimiter + process.env.PATH },
    stdio: ["ignore", output, output], detached: true,
  });
  processes.push(launcher);
  fs.closeSync(output);
  await waitFor(() => fs.readFileSync(log, "utf8").includes("[CI MODE] Staying in foreground"));
  assert.ok(exited(previous));
  assert.ok(await alive(outsider));
  const closed = new Promise((resolve) => launcher.once("exit", resolve));
  launcher.kill("SIGTERM");
  await closed;
  assert.ok(await alive(outsider));
  assert.deepEqual(manager.readRecords(root), {});
});

test("predev fixture copies custom icon sources and still rejects missing assets", async () => {
  const source = path.join(base, "custom app");
  const icons = { svg: "branding/icon.svg", ico: "branding/nested/site.ico", appleTouchIcon: "branding/touch.png" };
  const contents = { svg: "custom svg", ico: "custom ico", appleTouchIcon: "custom touch" };
  for (const [key, name] of Object.entries(icons)) {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), contents[key as keyof typeof contents]);
  }
  fs.writeFileSync(path.join(source, "branding/unrelated.txt"), "not an icon");
  fs.writeFileSync(path.join(root, "app.config.ts"), `export default ${JSON.stringify({
    ...rawAppConfig, brand: { ...rawAppConfig.brand, icons },
  })};\n`);
  fs.mkdirSync(path.join(root, "platform/apps/storybook"), { recursive: true });
  installPredev(root, source);
  assert.equal(fs.existsSync(path.join(root, "branding/unrelated.txt")), false);

  const result = await runScript("copy-shared-assets.sh");
  assert.equal(result.status, 0, result.stderr);
  const publicDir = path.join(root, "platform/apps/storybook/public");
  for (const [name, content] of Object.entries({ "icon.svg": contents.svg, "favicon.ico": contents.ico, "apple-touch-icon.png": contents.appleTouchIcon })) {
    assert.equal(fs.readFileSync(path.join(publicDir, name), "utf8"), content);
  }
  for (const app of ["apps/web", "platform/apps/admin", "apps/landing"]) {
    assert.equal(fs.existsSync(path.join(root, app)), false, `${app} remains absent`);
  }

  fs.unlinkSync(path.join(root, icons.appleTouchIcon));
  fs.writeFileSync(path.join(publicDir, "icon.svg"), "preserved");
  const missing = await runScript("copy-shared-assets.sh");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Source asset not found: branding\/touch\.png/);
  assert.equal(fs.readFileSync(path.join(publicDir, "icon.svg"), "utf8"), "preserved");

  fs.unlinkSync(path.join(source, icons.appleTouchIcon));
  assert.throws(() => installPredev(root, source), /ENOENT/);
});

test("predev fixture refuses icon symlinks outside the source checkout", () => {
  const source = path.join(base, "custom app");
  fs.mkdirSync(path.join(source, "branding"), { recursive: true });
  const outside = path.join(foreign, "icon.svg");
  fs.writeFileSync(outside, "outside icon");
  fs.symlinkSync(outside, path.join(source, "branding/icon.svg"));
  fs.writeFileSync(path.join(root, "app.config.ts"), `export default ${JSON.stringify({
    ...rawAppConfig, brand: { ...rawAppConfig.brand, icons: { ...rawAppConfig.brand.icons, svg: "branding/icon.svg" } },
  })};\n`);
  assert.throws(() => installPredev(root, source), /Icon source is outside source checkout/);
  assert.equal(fs.existsSync(path.join(root, "branding/icon.svg")), false);
  assert.equal(fs.readFileSync(outside, "utf8"), "outside icon");
});

for (const args of [["dev", "--app=storybook"], ["run", "dev:storybook"], ["run", "dev:landing"]]) {
  const app = args.at(-1)?.includes("landing") ? "landing" : "storybook";
  const appDir = app === "storybook" ? "platform/apps/storybook" : "apps/landing";
  test(`bun ${args.join(" ")} reaches the launcher through the real package scripts`, { timeout: 30_000 }, async () => {
    // Keep the public package scripts and predev helpers real. Only the external
    // server is substituted; this tests command wiring, not Next.js compilation.
    installPredev(root);
    fs.mkdirSync(path.join(root, appDir), { recursive: true });
    fs.writeFileSync(path.join(root, appDir, "package.json"), '{"name":"@repo/fixture"}');
    fs.writeFileSync(path.join(root, appDir, ".env.example"), "SMOKE_TEST_DEFAULT=seeded\n");
    // Recreate the isolated workspace layout behind the original predev bug.
    fs.mkdirSync(path.join(root, "apps/web/node_modules/@playwright/test"), { recursive: true });
    const bindir = path.join(root, "fake-bin");
    fs.mkdirSync(bindir);
    fs.writeFileSync(path.join(bindir, "bunx"), "#!/usr/bin/env node\nconst {createServer} = await import('node:http'); const server = createServer((req,res)=>res.end('fixture')); server.listen(0,()=>{console.log('Local: http://localhost:'+server.address().port);console.log('Ready in 1ms');});\n", { mode: 0o755 });
    fs.writeFileSync(path.join(bindir, "npx"), '#!/bin/bash\nif [ "$1" = "--version" ]; then echo fixture; exit 0; fi\necho "Unexpected package download during dev startup" >&2\nexit 127\n', { mode: 0o755 });

    if (app === "landing") {
      // Substitute Convex's executable boundary too: landing now needs its HTTP endpoint.
      fs.mkdirSync(path.join(root, "packages/backend"), { recursive: true });
      // Model the migration inventory executable boundary separately from its
      // own real inventory tests. The launcher still verifies source, target,
      // migration progress and the exact readiness receipt through real code.
      fs.mkdirSync(path.join(root, "packages/backend/convex/platform"), { recursive: true });
      fs.writeFileSync(path.join(root, "packages/backend/convex/platform/organizationReadiness.ts"), "export const ORGANIZATION_MIGRATION_CONTRACT_VERSION = 1;\n");
      fs.writeFileSync(path.join(root, "platform/tooling/organization-migration-check.ts"), `import {resolve} from "node:path"; import {fileURLToPath} from "node:url"; export const organizationFunctionRoot = root => resolve(root,"packages/backend/convex"); if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify({registryHash:${JSON.stringify("a".repeat(64))}}));\n`);
      fs.mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
      fs.writeFileSync(path.join(root, "node_modules/.bin/esbuild"), "#!/bin/sh\necho 0.25.0\n", { mode: 0o755 });
      fs.writeFileSync(path.join(root,"packages/convex/fixture.cjs"), "if(process.argv[2]!=='dev'){console.log('fixture');process.exit(0);}\nconst fs = require('node:fs');\nfs.writeFileSync('.env.local', 'CONVEX_DEPLOYMENT=anonymous:process-fixture\\nCONVEX_URL=http://127.0.0.1:43210\\nCONVEX_SITE_URL=http://127.0.0.1:43211\\n');\nfs.mkdirSync('.convex/local/default', { recursive: true });\nfs.writeFileSync('.convex/local/default/config.json', JSON.stringify({ deploymentName: 'process-fixture', adminKey: 'synthetic-local-key', ports: { cloud: 43210, site: 43211 } }));\nconsole.log('Convex functions ready');\nsetTimeout(() => {}, 300000);\n");
      fs.mkdirSync(path.join(root, "packages/backend/node_modules/.bin"), { recursive: true });
      fs.rmSync(path.join(root, "packages/backend/node_modules/.bin/convex"), { force: true });
      fs.writeFileSync(path.join(root, "packages/backend/node_modules/.bin/convex"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const file = '.organization-fixture.json';
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {env:{}, ready:false};
if (args.slice(0,3).join(' ') === 'env set --force') {
  const input = fs.readFileSync(0, 'utf8');
  if (!/^DEV_FIXTURE_SECRET=[a-f0-9]{64}$/m.test(input) || !input.includes('DEV_FIXTURE_RUNTIME=anonymous')) process.exit(1);
} else if (args.slice(0,2).join(' ') === 'env list') console.log(Object.keys(state.env).join('\\n'));
else if (args.slice(0,2).join(' ') === 'env set') state.env[args[2]]=args[3];
else if (args[0] === 'run') {
  if (args[1] === 'organizationMigration:status') console.log(JSON.stringify({deployment:'http://127.0.0.1:43210',expectedRegistryHash:'${"a".repeat(64)}',deploymentVersion:state.env.ORGANIZATION_DEPLOYMENT_VERSION,registryHash:state.env.ORGANIZATION_REGISTRY_HASH,ready:state.ready}));
  else if (args[1] === 'organizationMigration:begin') state.ready=false;
  else if (args[1] === 'organizationMigration:step') console.log('{"complete":true}');
  else if (args[1] === 'organizationMigration:finalize') {state.ready=true;console.log('{"ready":true}');}
  else process.exit(127);
} else process.exit(127);
fs.writeFileSync(file,JSON.stringify(state));
`, { mode: 0o755 });
      fs.writeFileSync(path.join(bindir, "bunx"), `#!/usr/bin/env node
if (process.argv[2] === 'convex') { console.log('fixture'); process.exit(0); }
const {createServer} = await import('node:http'); const server = createServer((req,res)=>res.end('fixture')); server.listen(0,()=>{console.log('Local: http://localhost:'+server.address().port);console.log('Ready in 1ms');});
`, { mode: 0o755 });
    }

    if (app === "landing") {
      // Model installed tool bins through postinstall; a real frozen install may
      // prune hand-written node_modules/.bin entries.
      const bins = ["node_modules/.bin/esbuild", "packages/backend/node_modules/.bin/convex"];
      const content = Object.fromEntries(bins.map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
      fs.writeFileSync(path.join(root, "fixture-install.cjs"), `const fs=require('node:fs'),path=require('node:path');for(const [file,source] of Object.entries(${JSON.stringify(content)})){fs.mkdirSync(path.dirname(file),{recursive:true});fs.rmSync(file,{force:true});fs.writeFileSync(file,source,{mode:0o755});}`);
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      manifest.scripts.postinstall = "node fixture-install.cjs";
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    }
    execFileSync("bun", ["install"], { cwd: root, stdio: "pipe" });
    const log = path.join(root, "bun-start.log");
    const output = fs.openSync(log, "w");
    const launcher = spawn("bun", args, {
      cwd: root,
      env: { ...process.env, CONVEX_LOCAL_BACKEND_VERSION: undefined, PATH: bindir + path.delimiter + process.env.PATH },
      stdio: ["ignore", output, output], detached: true,
    });
    processes.push(launcher);
    fs.closeSync(output);
    try {
      await waitFor(() => {
        const logs = fs.readFileSync(log, "utf8");
        assert.ok(!exited(launcher), logs);
        return logs.includes("[CI MODE] Staying in foreground");
      });
      assert.ok(fs.existsSync(path.join(root, appDir, "public/icon.svg")));
      if (args[0] === "dev") {
        assert.match(fs.readFileSync(path.join(root, appDir, ".env.local"), "utf8"), /SMOKE_TEST_DEFAULT=seeded/);
      }
      assert.deepEqual(Object.keys(manager.readRecords(root)).sort(), (app === "landing" ? ["convex", "next-landing"] : ["next-storybook"]));
      if (app === "landing") {
        assert.match(fs.readFileSync(path.join(root, appDir, ".env.local"), "utf8"), /NEXT_PUBLIC_CONVEX_SITE_URL=http:\/\/127\.0\.0\.1:43211/);
        const capabilityFile = path.join(root, ".env.e2e.local");
        assert.match(fs.readFileSync(capabilityFile, "utf8"), /^DEV_FIXTURE_SECRET=[a-f0-9]{64}$/m);
        assert.equal(fs.statSync(capabilityFile).mode & 0o777, 0o600);
        const organization = JSON.parse(fs.readFileSync(path.join(root, "packages/backend/.organization-fixture.json"), "utf8"));
        assert.equal(organization.ready, true);
        assert.equal(organization.env.ORGANIZATION_CUTOVER_ENFORCED, "1");
      }
      const status = await runScript("dev-status.sh");
      assert.match(status.stdout, new RegExp(app));
    } finally {
      // The process group belongs exclusively to this fixture. Stop the Bun
      // wrapper, launcher, and log tail even when a startup assertion fails.
      try { process.kill(-(launcher.pid as number), "SIGTERM"); } catch { /* Already exited. */ }
      // A shell exit trap can still be clearing ownership when Bun forwards
      // the same signal. Repeated group termination must not abort cleanup.
      for (let attempt = 0; attempt < 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 25));
        try { process.kill(-(launcher.pid as number), "SIGTERM"); } catch { /* Already exited. */ }
      }
      await waitFor(() => exited(launcher));
    }
    await waitFor(() => Object.keys(manager.readRecords(root)).length === 0);
  });
}

test("nuke is limited to registered git worktrees and preserves state", async () => {
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  };
  git("init");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "Fixture");
  const worktree = path.join(base, "second worktree");
  git("worktree", "add", "--detach", worktree);
  const first = spawnIn(root);
  const second = spawnIn(worktree);
  const outsider = spawnIn(foreign);
  track("convex", first);
  track("convex", second, worktree);
  const state = path.join(root, ".convex/standalone/database");
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, "keep my data");
  const result = await runScript("dev-nuke-all.sh", ["--yes"]);
  assert.equal(result.status, 0, result.stderr);
  await waitFor(() => exited(first) && exited(second));
  assert.ok(await alive(outsider));
  assert.equal(fs.readFileSync(state, "utf8"), "keep my data");
});

test("default startup starts landing with its browser backend", async () => {
  fs.writeFileSync(path.join(root, "platform/tooling/copy-shared-assets.sh"), "#!/bin/bash\nexit 17\n", { mode: 0o755 });
  fs.mkdirSync(path.join(root, "apps/landing"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/landing/package.json"), "{}");
  const result = await runScript("dev-start.sh", ["--ci"]);
  assert.equal(result.status, 17, result.stderr);
  assert.ok(result.stdout.includes("Apps: web=false admin=false landing=true storybook=false convex=true"));
});

test("explicit landing startup starts its browser backend", async () => {
  fs.mkdirSync(path.join(root, "apps/landing"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/landing/package.json"), "{}");
  // Exercise the public launcher, stopping at its first setup operation.
  fs.writeFileSync(path.join(root, "platform/tooling/copy-shared-assets.sh"), "#!/bin/bash\nexit 17\n", { mode: 0o755 });
  const result = await runScript("dev-start.sh", ["--ci", "--app=landing"]);
  assert.equal(result.status, 17, result.stderr);
  assert.ok(result.stdout.includes("Apps: web=false admin=false landing=true storybook=false convex=true"));
  assert.equal(fs.existsSync(path.join(root, "apps/landing/.env.local")), false);
});

test("a prior launch cannot stop a replacement record with the same service name", async () => {
  const original = spawnIn(root), replacement = spawnIn(root);
  track("next-storybook", original);
  manager.stop(root, "next-storybook", original.pid);
  track("next-storybook", replacement);
  manager.stop(root, "next-storybook", original.pid);
  assert.ok(await alive(replacement));
  assert.equal(manager.readRecords(root)["next-storybook"].pid, replacement.pid);
});
