// Keep every direct dependency floor at the version the lockfile resolves and CI tests.
// Usage: ./platform/tooling/node-ts.sh platform/tooling/dependency-floors.ts [--write] [ROOT]
//        (root scripts in the product: `bun run check:dependency-floors`, `bun run sync:dependency-floors`)
//
// A range such as `^16.3.3` states the oldest version the project claims to support, while the
// committed `bun.lock` decides what is installed and tested. When a lockfile is rebuilt, a floor
// below the adopted version lets the rebuild pick a version nobody tested, possibly one missing a
// security fix. This script compares each floor with the locked version and, with `--write`,
// raises the stale ones. Policy and the moments to run it: platform/docs/dependency-updates.md.
//
// Offline only: it reads the root `package.json` `workspaces`, the manifests they match, and
// `bun.lock`; never `node_modules` or the registry. It never resolves anything: a write edits
// one `"name": "range"` value in a manifest and in the matching `workspaces` entry of
// `bun.lock`, and leaves `packages` byte-identical.
//
// Checked: external entries of `dependencies` and `devDependencies`, as exact, `^` or `~` ranges.
// Skipped and listed: `peerDependencies` (intentional compatibility, never narrowed),
// `optionalDependencies`, `overrides`, local protocols (`workspace:`, `file:`, `link:`) and
// non-registry specifiers (git, URLs, `npm:` aliases). Anything else fails closed.
//
// Zones: in the product (no `.platform-base.json`) every manifest is in scope. In an adopted app
// the manifests in the platform zone (`isZonePath`) are neither read nor written.
//
// Exit codes: 0 in sync (or written), 1 stale floors in check mode, 2 error or conflict.
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BASE_FILE, isZonePath } from "./check-zone.ts";
import { compare, raiseFloor, satisfies, version } from "./platform-upgrade/semver.ts";

const CHECKED_SECTIONS = ["dependencies", "devDependencies"] as const;
const SKIPPED_SECTIONS = ["peerDependencies", "optionalDependencies"] as const;
const SUPPORTED_LOCKFILE_VERSIONS = [1, 2];
export const FIX_COMMAND = "./platform/tooling/node-ts.sh platform/tooling/dependency-floors.ts --write";

// ---------------------------------------------------------------------------
// A JSON reader that keeps the position of every value, so one string can be replaced in place
// and nothing else in the file changes. It also accepts the trailing commas `bun.lock` uses.
// ---------------------------------------------------------------------------

type Json =
  | { kind: "object"; start: number; end: number; members: Array<[string, Json]> }
  | { kind: "array"; start: number; end: number; items: Json[] }
  | { kind: "string"; start: number; end: number; value: string }
  | { kind: "number"; start: number; end: number; value: number }
  | { kind: "other"; start: number; end: number };

function parseJson(text: string, label: string): Json {
  let at = 0;
  const fail = (message: string): never => { throw new Error(`${label}: ${message} at offset ${at}`); };
  const skip = (): void => { while (at < text.length && /\s/.test(text[at])) at++; };
  const string = (): Json & { kind: "string" } => {
    const start = at;
    at++;
    let value = "";
    while (at < text.length && text[at] !== '"') {
      if (text[at] === "\\") {
        const escape = text.slice(at, at + 6);
        const unicode = /^\\u[0-9a-fA-F]{4}$/.test(escape);
        value += JSON.parse(`"${unicode ? escape : text.slice(at, at + 2)}"`);
        at += unicode ? 6 : 2;
      } else value += text[at++];
    }
    if (text[at] !== '"') fail("unterminated string");
    at++;
    return { kind: "string", start, end: at, value };
  };
  const value = (): Json => {
    skip();
    const start = at;
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === "{") {
      at++;
      const members: Array<[string, Json]> = [];
      for (;;) {
        skip();
        if (text[at] === "}") { at++; break; }
        if (text[at] !== '"') fail("expected a key");
        const key = string().value;
        skip();
        if (text[at] !== ":") fail("expected ':'");
        at++;
        members.push([key, value()]);
        skip();
        if (text[at] === ",") at++;
        else if (text[at] !== "}") fail("expected ',' or '}'");
      }
      return { kind: "object", start, end: at, members };
    }
    if (ch === "[") {
      at++;
      const items: Json[] = [];
      for (;;) {
        skip();
        if (text[at] === "]") { at++; break; }
        items.push(value());
        skip();
        if (text[at] === ",") at++;
        else if (text[at] !== "]") fail("expected ',' or ']'");
      }
      return { kind: "array", start, end: at, items };
    }
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at));
    if (!literal) return fail("unexpected character");
    at += literal[0].length;
    const number = Number(literal[0]);
    return Number.isNaN(number) ? { kind: "other", start, end: at } : { kind: "number", start, end: at, value: number };
  };
  const root = value();
  skip();
  if (at !== text.length) fail("unexpected trailing content");
  return root;
}

function member(node: Json | undefined, key: string): Json | undefined {
  return node?.kind === "object" ? node.members.find(([name]) => name === key)?.[1] : undefined;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

type Manifest = { dir: string; file: string; text: string; json: Json; name: string };

function readManifest(root: string, dir: string): Manifest {
  const file = dir === "" ? "package.json" : `${dir}/package.json`;
  const text = readFileSync(path.join(root, file), "utf8");
  const json = parseJson(text, file);
  const name = member(json, "name");
  if (name?.kind !== "string") throw new Error(`${file}: no "name"`);
  return { dir, file, text, json, name: name.value };
}

/** Workspace directories the root `workspaces` globs match: `dir/*` or an exact directory. */
function workspaceDirs(root: string, rootManifest: Manifest): string[] {
  const workspaces = member(rootManifest.json, "workspaces");
  if (workspaces?.kind !== "array") return [""];
  const dirs = [""];
  for (const item of workspaces.items) {
    if (item.kind !== "string") throw new Error('package.json: "workspaces" must list strings');
    const glob = item.value.replace(/^\.\//, "").replace(/\/$/, "");
    if (/[*?[\]{}!]/.test(glob.replace(/\/\*$/, ""))) throw new Error(`package.json: unsupported workspaces glob: ${item.value}`);
    if (glob.endsWith("/*")) {
      const parent = glob.slice(0, -2);
      const parentDir = path.join(root, parent);
      if (!existsSync(parentDir)) continue;
      for (const entry of readdirSync(parentDir).sort()) {
        if (entry === "node_modules" || !statSync(path.join(parentDir, entry)).isDirectory()) continue;
        if (existsSync(path.join(parentDir, entry, "package.json"))) dirs.push(`${parent}/${entry}`);
      }
    } else if (existsSync(path.join(root, glob, "package.json"))) dirs.push(glob);
  }
  return [...new Set(dirs)];
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type Edit = { file: string; start: number; end: number; from: string; to: string };
type Finding = { manifest: string; section: string; name: string; range: string; locked: string; next?: string };
export type Report = {
  mode: "product" | "adopted";
  checked: number;
  manifests: number;
  stale: Finding[];
  conflicts: Array<Finding & { override?: string }>;
  errors: string[];
  skipped: Map<string, string[]>;
  edits: Edit[];
  packagesText: string;
};

const SUPPORTED_RANGE = /^(\^|~)?(\d+\.\d+\.\d+)$/;
const LOCAL = /^(?:workspace|file|link):/;
const NON_REGISTRY = /^(?:npm|git|git\+[a-z]+|https?|github|gitlab|bitbucket|catalog|jsr):|:\/\/|^[\w.-]+\/[\w.-]+(?:#.*)?$/;

function lockedVersion(packages: Json | undefined, workspaceName: string, dep: string): string | undefined {
  const entry = member(packages, `${workspaceName}/${dep}`) ?? member(packages, dep);
  if (entry?.kind !== "array") return undefined;
  const id = entry.items[0];
  if (id?.kind !== "string") return undefined;
  const cut = id.value.lastIndexOf("@");
  return cut > 0 ? id.value.slice(cut + 1) : undefined;
}

export function analyze(root: string): Report {
  const adopted = existsSync(path.join(root, BASE_FILE));
  const report: Report = { mode: adopted ? "adopted" : "product", checked: 0, manifests: 0, stale: [], conflicts: [], errors: [], skipped: new Map(), edits: [], packagesText: "" };
  const skip = (manifest: string, what: string): void => { report.skipped.set(manifest, [...(report.skipped.get(manifest) ?? []), what]); };

  const lockText = readFileSync(path.join(root, "bun.lock"), "utf8");
  const lock = parseJson(lockText, "bun.lock");
  const lockVersion = member(lock, "lockfileVersion");
  if (lockVersion?.kind !== "number" || !SUPPORTED_LOCKFILE_VERSIONS.includes(lockVersion.value)) {
    throw new Error(`bun.lock: unsupported lockfileVersion (supported: ${SUPPORTED_LOCKFILE_VERSIONS.join(", ")})`);
  }
  const lockWorkspaces = member(lock, "workspaces");
  const packages = member(lock, "packages");
  const lockOverrides = member(lock, "overrides");
  if (lockWorkspaces?.kind !== "object" || packages?.kind !== "object") throw new Error('bun.lock: no "workspaces" or "packages" section');
  report.packagesText = lockText.slice(packages.start, packages.end);

  const rootManifest = readManifest(root, "");
  for (const dir of workspaceDirs(root, rootManifest)) {
    // Decide on the path alone: a zone manifest in an adopted app is not even read.
    if (adopted && isZonePath(dir === "" ? "package.json" : `${dir}/package.json`)) continue;
    const manifest = dir === "" ? rootManifest : readManifest(root, dir);
    report.manifests++;
    const lockWorkspace = member(lockWorkspaces, dir);
    if (!lockWorkspace) { report.errors.push(`${manifest.file}: the workspace is missing from bun.lock (run bun install)`); continue; }

    for (const section of SKIPPED_SECTIONS) {
      const node = member(manifest.json, section);
      if (node?.kind === "object" && node.members.length > 0) skip(manifest.file, `${section}: ${node.members.map(([name]) => name).join(", ")}`);
    }
    const overrides = member(manifest.json, "overrides");
    if (overrides?.kind === "object" && overrides.members.length > 0) skip(manifest.file, `overrides: ${overrides.members.map(([name]) => name).join(", ")}`);

    for (const section of CHECKED_SECTIONS) {
      const declared = member(manifest.json, section);
      if (declared?.kind !== "object") continue;
      for (const [name, node] of declared.members) {
        const where = `${manifest.file}: ${section}.${name}`;
        if (node.kind !== "string") { report.errors.push(`${where}: the range must be a string`); continue; }
        const range = node.value;
        if (LOCAL.test(range)) { skip(manifest.file, `local: ${name} (${range})`); continue; }
        if (NON_REGISTRY.test(range)) { skip(manifest.file, `non-registry: ${name} (${range})`); continue; }
        const match = SUPPORTED_RANGE.exec(range);
        if (!match) { report.errors.push(`${where}: unsupported range ${JSON.stringify(range)} (supported: exact, ^ and ~; prereleases are not)`); continue; }

        const lockRange = member(member(lockWorkspace, section), name);
        if (lockRange?.kind !== "string") { report.errors.push(`${where}: not in the bun.lock workspace entry (run bun install)`); continue; }
        if (lockRange.value !== range) { report.errors.push(`${where}: package.json says ${range} but bun.lock says ${lockRange.value} (run bun install)`); continue; }

        const locked = lockedVersion(packages, manifest.name, name);
        if (locked === undefined) { report.errors.push(`${where}: no locked version in bun.lock`); continue; }
        try { version(locked); } catch { report.errors.push(`${where}: unsupported locked version ${locked} (prereleases are not supported)`); continue; }

        report.checked++;
        const finding: Finding = { manifest: manifest.file, section, name, range, locked };
        if (!satisfies(locked, range)) {
          const override = lockOverrides?.kind === "object" ? member(lockOverrides, name) : undefined;
          report.conflicts.push({ ...finding, override: override?.kind === "string" ? override.value : undefined });
          continue;
        }
        if (compare(match[2], locked) >= 0) continue;
        const raised = raiseFloor(range, locked);
        if (raised.value === undefined) { report.errors.push(`${where}: cannot raise ${range} to ${locked}: ${raised.reason}`); continue; }
        report.stale.push({ ...finding, next: raised.value });
        report.edits.push({ file: manifest.file, start: node.start + 1, end: node.end - 1, from: range, to: raised.value });
        report.edits.push({ file: "bun.lock", start: lockRange.start + 1, end: lockRange.end - 1, from: range, to: raised.value });
      }
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Output and writing
// ---------------------------------------------------------------------------

function describe(report: Report, out: (line: string) => void, write: boolean): void {
  const byManifest = new Map<string, string[]>();
  const add = (manifest: string, line: string): void => { byManifest.set(manifest, [...(byManifest.get(manifest) ?? []), line]); };
  for (const finding of report.stale) add(finding.manifest, `  ${write ? "raised" : "stale"}  ${finding.name}  (${finding.section})  ${finding.range} -> ${finding.next}  (locked ${finding.locked})`);
  for (const conflict of report.conflicts) {
    add(conflict.manifest, `  CONFLICT  ${conflict.name}  (${conflict.section})  range ${conflict.range} does not allow the locked ${conflict.locked}${conflict.override ? `; bun.lock override ${conflict.override}` : ""}`);
  }
  for (const [manifest, notes] of report.skipped) for (const note of notes) add(manifest, `  skipped  ${note}`);
  out(`Dependency floors (${report.mode}): ${report.checked} declarations in ${report.manifests} manifests.`);
  for (const manifest of [...byManifest.keys()].sort()) {
    out(manifest);
    for (const line of byManifest.get(manifest) ?? []) out(line);
  }
  for (const error of report.errors) out(`ERROR  ${error}`);
}

function writeAtomic(file: string, text: string): void {
  const temporary = `${file}.floors-${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text);
    renameSync(temporary, file);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* nothing to clean up */ }
    throw error;
  }
}

function applyEdits(text: string, edits: Edit[], file: string): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (result.slice(edit.start, edit.end) !== edit.from) throw new Error(`${file}: expected ${edit.from} at offset ${edit.start}`);
    result = result.slice(0, edit.start) + edit.to + result.slice(edit.end);
  }
  return result;
}

/** Write every edit, or none: on any failure every file is put back as it was. */
function writeAll(root: string, report: Report, testHook?: (file: string) => void): void {
  const files = [...new Set(report.edits.map((edit) => edit.file))].sort();
  const originals = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
  const updated = new Map(files.map((file) => [file, applyEdits(originals.get(file) ?? "", report.edits.filter((edit) => edit.file === file), file)]));
  const written: string[] = [];
  const restore = (): void => { for (const file of written) writeAtomic(path.join(root, file), originals.get(file) ?? ""); };
  try {
    for (const file of files) {
      testHook?.(file);
      writeAtomic(path.join(root, file), updated.get(file) ?? "");
      written.push(file);
    }
    const after = analyze(root);
    if (after.errors.length > 0 || after.conflicts.length > 0 || after.stale.length > 0) throw new Error("the floors are still out of sync after writing");
    if (after.packagesText !== report.packagesText) throw new Error('bun.lock "packages" changed; writing must never resolve');
  } catch (error) {
    restore();
    throw error;
  }
}

export function main(argv: readonly string[], out: (line: string) => void = (line) => process.stdout.write(`${line}\n`), testHook?: (file: string) => void): number {
  const write = argv.includes("--write");
  const unknown = argv.filter((arg) => arg.startsWith("--") && arg !== "--write");
  if (unknown.length > 0) { out(`Unknown option: ${unknown.join(" ")}`); return 2; }
  const root = path.resolve(argv.find((arg) => !arg.startsWith("--")) ?? ".");

  let report: Report;
  try { report = analyze(root); } catch (error) { out(`ERROR  ${(error as Error).message}`); return 2; }
  const blocked = report.errors.length > 0 || report.conflicts.length > 0;
  if (!blocked && write && report.stale.length > 0) {
    try { writeAll(root, report, testHook); } catch (error) {
      describe(report, out, false);
      out(`ERROR  nothing was changed: ${(error as Error).message}`);
      return 2;
    }
  }
  describe(report, out, write && !blocked);
  if (blocked) {
    out(write ? "Nothing was written: fix the errors and conflicts above first." : "Fix the errors and conflicts above; the script never resolves a conflict itself.");
    return 2;
  }
  if (report.stale.length === 0) { out("Floors are in sync with bun.lock."); return 0; }
  if (write) { out(`Raised ${report.stale.length} floor(s) in manifests and bun.lock; bun.lock "packages" is unchanged.`); return 0; }
  out(`${report.stale.length} floor(s) are below the locked version. Run: ${FIX_COMMAND}`);
  return 1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
