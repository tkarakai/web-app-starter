#!/usr/bin/env node
/**
 * Manage only recorded development processes belonging to one checkout.
 *
 * Process names and port numbers are not ownership evidence. Never discover or
 * kill global "orphans". The legacy .dev-pids file remains for launcher/status
 * compatibility; .dev-processes.json supplies the process start identities.
 *
 * Usage: scripts/node-ts.sh scripts/dev-processes.ts [--root DIR] track NAME PID
 *                                                      [--root DIR] running NAME|* PID
 *                                                      [--root DIR] stop [--name NAME]
 *                                                      [--root DIR] list
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ProcessRecord = { pid: number; started: string };
export type Records = Record<string, ProcessRecord>;

const RECORDS = ".dev-processes.json";

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ps(pid: number, fields: string): string {
  const result = spawnSync("ps", ["-p", String(pid), "-o", fields], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function identity(pid: number): string {
  if (pid <= 1 || ps(pid, "stat=").startsWith("Z")) return "";
  let started = ps(pid, "lstart=");
  if (!started) return "";
  // Linux provides a more precise identity than ps's wall-clock seconds.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const ticks = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[19];
    if (ticks) started += ":" + ticks;
  } catch {
    // No /proc on macOS; the ps start time is the identity.
  }
  return started;
}

function resolved(directory: string): string {
  try {
    return fs.realpathSync(directory);
  } catch {
    return path.resolve(directory);
  }
}

function cwd(pid: number): string | null {
  try {
    if (fs.existsSync("/proc") && fs.statSync("/proc").isDirectory()) {
      return fs.realpathSync(`/proc/${pid}/cwd`);
    }
    const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    const line = (result.stdout ?? "").split("\n").find((entry) => entry.startsWith("n"));
    return line ? resolved(line.slice(1)) : null;
  } catch {
    return null;
  }
}

function inside(root: string, directory: string | null): boolean {
  return directory !== null && (directory === root || directory.startsWith(root + path.sep));
}

function ancestors(): Set<number> {
  const result = new Set<number>();
  let pid = process.pid;
  while (pid > 1 && !result.has(pid)) {
    result.add(pid);
    const parent = ps(pid, "ppid=");
    if (!parent) break;
    pid = Number.parseInt(parent, 10);
  }
  return result;
}

function matches(root: string, record: Partial<ProcessRecord>): boolean {
  const { pid, started } = record;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 1 && Boolean(started)
    && identity(pid) === started && inside(root, cwd(pid));
}

export function readRecords(root: string): Records {
  const file = path.join(root, RECORDS);
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw error;
  }
  const data = JSON.parse(content) as { root?: unknown; services?: unknown };
  const services = data.services;
  if (data.root !== root || typeof services !== "object" || services === null || Array.isArray(services)) {
    throw new Error("Process records belong to another checkout or are invalid; no processes stopped.");
  }
  return services as Records;
}

export function writeRecords(root: string, records: Records): void {
  const directory = fs.mkdtempSync(path.join(root, ".dev-processes-"));
  const temp = path.join(directory, "records.json");
  try {
    fs.writeFileSync(temp, JSON.stringify({ root, services: records }), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, path.join(root, RECORDS));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function track(root: string, name: string, pid: number): void {
  // A background shell may still be entering its application's directory.
  for (let attempt = 0; attempt < 20; attempt++) {
    const started = identity(pid);
    if (started && inside(root, cwd(pid))) {
      const records = readRecords(root);
      records[name] = { pid, started };
      writeRecords(root, records);
      return;
    }
    sleep(50);
  }
  throw new Error(`Cannot verify ownership of ${name} (PID ${pid}); process was not registered.`);
}

function tree(root: string, record: ProcessRecord, protectedPids: Set<number>): ProcessRecord[] {
  const pid = record.pid;
  if (protectedPids.has(pid) || !matches(root, record)) return [];
  const result = [record];
  const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  for (const child of (children.stdout ?? "").split(/\s+/).filter(Boolean)) {
    const childPid = Number.parseInt(child, 10);
    result.push(...tree(root, { pid: childPid, started: identity(childPid) }, protectedPids));
  }
  return result;
}

function signalVerified(root: string, record: ProcessRecord, signal: "SIGTERM" | "SIGKILL"): void {
  if (!matches(root, record)) return;
  try {
    process.kill(record.pid, signal);
  } catch (error) {
    if ((error as { code?: string }).code !== "ESRCH") throw error;
  }
}

export function stop(root: string, name?: string): void {
  const records = readRecords(root);
  const selected = Object.entries(records).filter(([key]) => name === undefined || key === name);
  const protectedPids = ancestors();
  const targets = new Map<number, ProcessRecord>();
  for (const [service, record] of selected) {
    const owned = tree(root, record, protectedPids);
    if (!owned.length) console.log(`Skipping stopped or unverified ${service} (PID ${record.pid}).`);
    for (const owner of owned) targets.set(owner.pid, owner);
  }
  // Snapshot descendants before signalling their parents; recheck identity
  // and checkout directory before every signal, including forced termination.
  const ordered = [...targets.values()].reverse();
  for (const record of ordered) signalVerified(root, record, "SIGTERM");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && ordered.some((record) => matches(root, record))) sleep(50);
  for (const record of ordered) signalVerified(root, record, "SIGKILL");
  for (const [service] of selected) delete records[service];
  writeRecords(root, records);

  cleanLegacyRecords(root, new Set(selected.map(([service]) => service)), name);
  console.log(`Stopped ${targets.size} verified process(es) in ${root}.`);
}

function cleanLegacyRecords(root: string, stopped: Set<string>, name?: string): void {
  let fd: number;
  try {
    // Open once without following symlinks. Nonblocking open also lets us reject
    // a FIFO instead of waiting forever for a writer.
    fd = fs.openSync(path.join(root, ".dev-pids"), fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("Legacy PID records must be a regular file with a single link.");
    const remaining: string[] = [];
    for (const line of fs.readFileSync(fd, "utf8").split(/\r?\n/).filter(Boolean)) {
      const service = line.split(":")[0];
      if (name !== undefined && service !== name) {
        remaining.push(line);
      } else if (!stopped.has(service)) {
        console.log(`Ignoring legacy ${service} PID without an identity record. `
          + "Stop pre-upgrade servers from their original terminal if still running.");
      }
    }
    const content = Buffer.from(remaining.length ? remaining.join("\n") + "\n" : "");
    for (let offset = 0; offset < content.length;) {
      offset += fs.writeSync(fd, content, offset, content.length - offset, offset);
    }
    // Leave an empty file when nothing remains: unlinking the path could delete
    // a replacement created since open. All reads/writes target this descriptor.
    fs.ftruncateSync(fd, content.length);
  } finally {
    fs.closeSync(fd);
  }
}

function integer(value: string | undefined): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed)) throw new Error(`Invalid PID: ${value ?? "(missing)"}`);
  return parsed;
}

export function main(argv: string[]): number {
  const args = [...argv];
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (args[0] === "--root") {
    args.shift();
    root = args.shift() ?? "";
  }
  root = fs.realpathSync(root);
  const [command, ...rest] = args;
  if (command === "track") {
    track(root, rest[0] ?? "", integer(rest[1]));
    return 0;
  }
  if (command === "stop") {
    if (rest.length && (rest[0] !== "--name" || rest.length !== 2)) throw new Error("Usage: stop [--name NAME]");
    stop(root, rest[1]);
    return 0;
  }
  if (command === "running") {
    const [name, pid] = [rest[0], integer(rest[1])];
    const records = readRecords(root);
    const candidates: Partial<ProcessRecord>[] = name === "*" ? Object.values(records) : [records[name ?? ""] ?? {}];
    return candidates.some((record) => record.pid === pid && matches(root, record)) ? 0 : 1;
  }
  if (command === "list") {
    for (const [service, record] of Object.entries(readRecords(root))) {
      if (matches(root, record)) console.log(`${service}: ${record.pid}`);
    }
    return 0;
  }
  throw new Error("Usage: dev-processes.ts [--root DIR] {track NAME PID|running NAME PID|stop [--name NAME]|list}");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`Development process management: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
