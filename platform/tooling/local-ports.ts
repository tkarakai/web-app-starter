/**
 * Machine-wide leases for local stacks started from different checkouts at the same time.
 *
 * A probed free port stays free only until someone binds it, and managed stacks bind seconds
 * after planning. Each claim is a file named `<key>.<owner pid>.<token>` in one per-user
 * directory. A claimant writes its file first and then looks for another live claim on the
 * same key; if it finds one it withdraws. Two simultaneous claimants can both withdraw, but
 * never both win. Claims of exited owners are stale and removed by the next claimant.
 *
 * This module is imported by Playwright configs (transpiled to CommonJS), so it must stay
 * synchronous and avoid `import.meta`.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";

/** Chrome refuses a list of "unsafe" ports, all at or below this one. */
const HIGHEST_BROWSER_BLOCKED_PORT = 10080;

export function leaseDirectory(): string {
  // process.getuid works without a passwd entry (containers started with --user UID).
  const uid = typeof process.getuid === "function" ? process.getuid() : userInfo().uid;
  const directory = process.env.PLATFORM_PORT_LEASE_DIR || join("/tmp", `web-app-starter-leases-${uid}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  const foreign = typeof process.getuid === "function" && stat.uid !== process.getuid();
  if (!stat.isDirectory() || foreign || (stat.mode & 0o022) !== 0) throw new Error(`Refusing unsafe local lease directory ${directory}`);
  return directory;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as Error & { code?: string }).code === "EPERM";
  }
}

function ownerOf(entry: string, key: string): number | undefined {
  if (!entry.startsWith(`${key}.`)) return undefined;
  const pid = Number(entry.slice(key.length + 1).split(".")[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** Claim `key` for `owner`. Returns the claim to release, or undefined while another live owner holds it. */
export function tryClaim(key: string, owner: number = process.pid): string | undefined {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error(`Invalid lease key ${key}`);
  const directory = leaseDirectory();
  const claim = `${key}.${owner}.${randomBytes(6).toString("hex")}`;
  fs.writeFileSync(join(directory, claim), "", { flag: "wx", mode: 0o600 });
  for (const entry of fs.readdirSync(directory)) {
    const pid = entry === claim ? undefined : ownerOf(entry, key);
    if (pid === undefined || pid === owner) continue;
    if (alive(pid)) {
      fs.rmSync(join(directory, claim), { force: true });
      return undefined;
    }
    fs.rmSync(join(directory, entry), { force: true });
  }
  return claim;
}

export function releaseClaim(claim: string): void {
  if (claim) fs.rmSync(join(leaseDirectory(), claim), { force: true });
}

/** Release every claim held by `owner` (on `key` only, when given): a launcher that exits or gives up. */
export function releaseOwned(key: string | undefined, owner: number): void {
  const directory = leaseDirectory();
  for (const entry of fs.readdirSync(directory)) {
    const pid = key === undefined ? Number(entry.split(".")[1]) : ownerOf(entry, key);
    if (pid === owner) fs.rmSync(join(directory, entry), { force: true });
  }
}

/** Ports the OS reports free right now, from a child process because binding is asynchronous. */
function unboundPorts(count: number): number[] {
  const probe = `const net = require("node:net"); const servers = [];
for (let i = 0; i < ${count}; i++) servers.push(net.createServer());
let ready = 0;
for (const server of servers) {
  server.once("error", error => { process.stderr.write(String(error)); process.exit(1); });
  server.listen(0, () => { if (++ready === servers.length) { process.stdout.write(JSON.stringify(servers.map(s => s.address().port))); for (const s of servers) s.close(); } });
}`;
  const result = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" }, timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`Cannot find free local ports: ${result.error?.message ?? result.stderr}`);
  return JSON.parse(result.stdout) as number[];
}

/**
 * Distinct free ports for `names`, leased to `owner` until it exits or releases them. They are
 * OS-assigned, so they stay clear of configured app ports used by interactive dev servers.
 */
export function reservePorts(names: readonly string[], owner: number = process.pid): { ports: Record<string, number>; claims: string[] } {
  const ports: Record<string, number> = {};
  const claims: string[] = [];
  for (let attempt = 0; attempt < 20 && claims.length < names.length; attempt++) {
    for (const port of unboundPorts(names.length - claims.length + 2)) {
      const name = names.find(candidate => !(candidate in ports));
      if (name === undefined) break;
      if (port <= HIGHEST_BROWSER_BLOCKED_PORT || Object.values(ports).includes(port)) continue;
      let claim: string | undefined;
      try {
        claim = tryClaim(`port-${port}`, owner);
      } catch (error) {
        // Leases only coordinate checkouts; without a usable directory, keep the OS-assigned port.
        process.stderr.write(`Port leases unavailable (${(error as Error).message}); continuing without them.\n`);
        claim = "";
      }
      if (claim === undefined) continue;
      ports[name] = port;
      claims.push(claim);
    }
  }
  if (claims.length < names.length) {
    for (const claim of claims) releaseClaim(claim);
    throw new Error(`Could not reserve ${names.length} free local ports`);
  }
  return { ports, claims };
}

/** Wait (synchronously) until `key` is free of other live owners, then hold it for `owner`. */
export function acquireLock(key: string, owner: number, timeoutMs: number, onWait: () => void): boolean {
  const deadline = Date.now() + timeoutMs;
  let waited = false;
  for (;;) {
    if (tryClaim(key, owner) !== undefined) return true;
    if (Date.now() >= deadline) return false;
    if (!waited) { waited = true; onWait(); }
    // Randomized backoff, so claimants that withdrew together do not retry in step.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 + Math.floor(Math.random() * 300));
  }
}

if (process.argv[1]?.endsWith("/local-ports.ts")) {
  const [command, ...rest] = process.argv.slice(2);
  const [key, ownerArgument, timeoutArgument] = command === "release" ? [undefined, rest[0]] : rest;
  const owner = Number(ownerArgument);
  if ((command !== "release" && !key) || !Number.isInteger(owner) || owner <= 0 || !["lock", "unlock", "claim", "release"].includes(command ?? "")) {
    process.stderr.write("Usage: local-ports.ts lock|unlock|claim KEY OWNER_PID [TIMEOUT_SECONDS] | release OWNER_PID\n");
    process.exit(2);
  }
  try {
    if (command === "release") {
      releaseOwned(undefined, owner);
    } else if (command === "claim") {
      // Exit 3 while another live owner holds the key; the caller tries another. Any other
      // failure (including Node's own exit 1) means "leases unavailable".
      if (tryClaim(key!, owner) === undefined) process.exit(3);
    } else if (command === "unlock") {
      releaseOwned(`lock-${key}`, owner);
    } else {
      const seconds = Number(timeoutArgument ?? "120");
      const acquired = acquireLock(`lock-${key}`, owner, seconds * 1000, () => process.stderr.write(`Waiting for another checkout to finish its ${key}...\n`));
      if (!acquired) process.stderr.write(`Still waiting after ${seconds}s for another checkout's ${key}; continuing without the lock.\n`);
    }
  } catch (error) {
    // Exit 2, never 3 (held): callers continue without coordination rather than fail.
    process.stderr.write(`Local leases unavailable: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
