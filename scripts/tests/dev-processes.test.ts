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

for (const args of [["dev", "--app=storybook"], ["run", "dev:storybook"]]) {
  test(`bun ${args.join(" ")} reaches the launcher through the real package scripts`, { timeout: 30_000 }, async () => {
    // Keep the public package scripts and predev helpers real. Only the external
    // server is substituted; this tests command wiring, not Next.js compilation.
    fs.copyFileSync(path.join(SCRIPTS, "../package.json"), path.join(root, "package.json"));
    for (const name of ["ensure-local-deps.sh", "ensure-app-env.sh", "copy-shared-assets.sh"]) {
      fs.copyFileSync(path.join(SCRIPTS, name), path.join(root, "scripts", name));
    }
    fs.cpSync(path.join(SCRIPTS, "../packages/design-system/assets"), path.join(root, "packages/design-system/assets"), { recursive: true });
    fs.mkdirSync(path.join(root, "apps/storybook"), { recursive: true });
    fs.writeFileSync(path.join(root, "apps/storybook/.env.example"), "SMOKE_TEST_DEFAULT=seeded\n");
    // Recreate the isolated workspace layout behind the original predev bug.
    fs.mkdirSync(path.join(root, "apps/web/node_modules/@playwright/test"), { recursive: true });
    const bindir = path.join(root, "fake-bin");
    fs.mkdirSync(bindir);
    fs.writeFileSync(path.join(bindir, "bunx"), "#!/usr/bin/env node\nconsole.log('Local: http://localhost:3999');\nconsole.log('Ready in 1ms');\nsetTimeout(() => {}, 300000);\n", { mode: 0o755 });
    fs.writeFileSync(path.join(bindir, "npx"), '#!/bin/bash\nif [ "$1" = "--version" ]; then echo fixture; exit 0; fi\necho "Unexpected package download during dev startup" >&2\nexit 127\n', { mode: 0o755 });

    const log = path.join(root, "bun-start.log");
    const output = fs.openSync(log, "w");
    const launcher = spawn("bun", args, {
      cwd: root,
      env: { ...process.env, PATH: bindir + path.delimiter + process.env.PATH },
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
      assert.ok(fs.existsSync(path.join(root, "apps/storybook/public/icon.svg")));
      if (args[0] === "dev") {
        assert.match(fs.readFileSync(path.join(root, "apps/storybook/.env.local"), "utf8"), /SMOKE_TEST_DEFAULT=seeded/);
      }
      assert.ok(Object.keys(manager.readRecords(root)).includes("next-storybook"));
    } finally {
      // The process group belongs exclusively to this fixture. Stop the Bun
      // wrapper, launcher, and log tail even when a startup assertion fails.
      try { process.kill(-(launcher.pid as number), "SIGTERM"); } catch { /* Already exited. */ }
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
