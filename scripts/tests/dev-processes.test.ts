/**
 * Run with: bun run test:dev-scripts
 *
 * Real disposable processes and checkouts exercise ownership without touching
 * running development services or Convex databases.
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as manager from "../dev-processes.ts";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLED = ["package.json", "node-ts.sh", "dev-processes.ts", "dev-start.sh", "dev-stop.sh", "dev-stop-convex.sh", "dev-nuke-all.sh", "dev-status.sh"];

let temp: string, base: string, root: string, foreign: string, processes: ChildProcess[];

function install(checkout: string): void {
  fs.mkdirSync(path.join(checkout, "scripts"), { recursive: true });
  for (const name of INSTALLED) fs.copyFileSync(path.join(SCRIPTS, name), path.join(checkout, "scripts", name));
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

function runScript(name: string, args: string[] = [], checkout = root): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [path.join(checkout, "scripts", name), ...args], { stdio: ["ignore", "pipe", "pipe"] });
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

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for disposable process");
}

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "dev process isolation "));
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
  fs.mkdirSync(path.join(root, "apps/storybook"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts/copy-shared-assets.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const bindir = path.join(root, "fake-bin");
  fs.mkdirSync(bindir);
  const fakes: Record<string, string> = {
    bun: "#!/bin/sh\necho 1.3.9\n",
    bunx: "#!/usr/bin/env node\nconsole.log('Local: http://localhost:3999');\nconsole.log('Ready in 1ms');\nsetTimeout(() => {}, 300000);\n",
  };
  for (const [name, content] of Object.entries(fakes)) fs.writeFileSync(path.join(bindir, name), content, { mode: 0o755 });
  const log = path.join(root, "start.log");
  const output = fs.openSync(log, "w");
  const launcher = spawn("bash", [path.join(root, "scripts/dev-start.sh"), "--ci", "--app=storybook"], {
    cwd: root, env: { ...process.env, PATH: bindir + path.delimiter + process.env.PATH },
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
