import { createHash } from "node:crypto";
import * as path from "node:path";
import { isZonePath, secretValueFile } from "./ownership.ts";
import { compare, satisfies, version } from "./semver.ts";

export const PROTOCOL = 1;
export const MANIFEST = "platform/releases/breaking-changes.json";
export const ADVISORIES = "platform/releases/advisories.json";
export const ENTRY = "platform/tooling/platform-upgrade/run.ts";
export type Seam = { id: string; path: string; hooks: string[]; optionalApp?: string };
export type Codemod = { id: string; path: string; touches: string[] };
export type Migration = { id: string; changesRows: boolean; expansion: string; contract: string; dependsOn: string[]; statusCommand: string[]; completion: string; instructions: string };
export type EnvChange = { name: string; kind: "new" | "removed" | "renamed"; secret: boolean; required: boolean; replacement?: string };
export type DependencyFloor = { path: string; name: string; minimum: string; optionalApp?: string };
export type Release = { version: string; previous: string | null; supportedBaseline: string; codemods: Codemod[]; migrations: Migration[]; env: EnvChange[]; removedFiles: string[]; renamedExports: { from: string; to: string }[]; dependencyFloors: DependencyFloor[]; changedSeams: string[] };
export type Manifest = { schemaVersion: 1; runtime: { nodeMajor: number; bun: string }; seams: Seam[]; releases: Release[] };
export type Advisory = { id: string; severity: "low" | "medium" | "high" | "critical"; affected: string; fixed: string; summary: string };
export type AdvisoryManifest = { schemaVersion: 1; advisories: Advisory[] };

export function demand(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
export function hasControl(value: string): boolean { return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127); }
export function safeRelative(value: string, prefix = false): string {
  demand(typeof value === "string" && value.length > 0 && value.length < 1024, "Missing/oversized path");
  const normalized = prefix && value.endsWith("/") ? value.slice(0, -1) : value;
  demand(!/[\\:]/.test(normalized) && !hasControl(normalized) && !path.posix.isAbsolute(normalized), "Unsafe path: " + value);
  demand(normalized.split("/").every(part => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git"), "Unsafe path: " + value);
  return value;
}
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  demand(value && typeof value === "object" && !Array.isArray(value), label + " must be an object");
  demand(Object.keys(value).every(key => keys.includes(key)), label + " has unknown fields");
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string { demand(typeof value === "string" && value.trim().length > 0 && value.length <= 8192, label + " must be a nonempty string"); return value; }
function list<T>(value: unknown, parse: (v: unknown) => T, label: string): T[] { demand(Array.isArray(value) && value.length <= 10000, label + " must be an array"); return value.map(parse); }
function strings(value: unknown, label: string): string[] { return list(value, item => string(item, label), label); }
function id(value: unknown): string { const result = string(value, "id"); demand(/^[a-z0-9][a-z0-9._-]*$/.test(result), "Invalid id: " + result); return result; }
function file(value: unknown): string { return safeRelative(string(value, "path")); }
function optionalApp(value: unknown): string | undefined { return value === undefined ? undefined : file(value); }
function bool(value: unknown): boolean { demand(typeof value === "boolean", "Expected boolean"); return value; }
function unique<T>(rows: T[], key: (row: T) => string, label: string): void { demand(new Set(rows.map(key)).size === rows.length, "Duplicate " + label); }

export function parseManifest(text: string): Manifest {
  const raw = object(JSON.parse(text), ["schemaVersion", "runtime", "seams", "releases"], "manifest");
  demand(raw.schemaVersion === 1, "Unsupported breaking-change manifest schema");
  const runtime = object(raw.runtime, ["nodeMajor", "bun"], "runtime");
  demand(Number.isInteger(runtime.nodeMajor) && Number(runtime.nodeMajor) >= 24, "Unsupported Node runtime");
  const bun = string(runtime.bun, "Bun runtime"); version(bun);
  const seams = list(raw.seams, value => {
    const row = object(value, ["id", "path", "hooks", "optionalApp"], "seam");
    return { id: id(row.id), path: file(row.path), hooks: strings(row.hooks, "hooks"), optionalApp: optionalApp(row.optionalApp) };
  }, "seams");
  demand(seams.every(row => !isZonePath(row.path)), "Platform zone paths cannot be three-way seams");
  demand(seams.every(row => !secretValueFile(row.path) && ![".platform-base.json", "bun.lock"].includes(row.path.toLowerCase())), "Secrets, baseline and lockfile are not mergeable seams");
  unique(seams, row => row.id, "seam ID"); unique(seams, row => row.path, "seam path");
  const releases = list(raw.releases, value => {
    const row = object(value, ["version", "previous", "supportedBaseline", "codemods", "migrations", "env", "removedFiles", "renamedExports", "dependencyFloors", "changedSeams"], "release");
    const releaseVersion = string(row.version, "release version"); version(releaseVersion);
    const previous = row.previous === null ? null : string(row.previous, "previous release"); if (previous) version(previous);
    const supportedBaseline = string(row.supportedBaseline, "supported baseline"); satisfies(releaseVersion, supportedBaseline);
    const codemods = list(row.codemods, value => {
      const item = object(value, ["id", "path", "touches"], "codemod");
      const entry = file(item.path); demand(entry.startsWith("platform/tooling/codemods/") && entry.endsWith(".ts"), "Codemod entry must be a platform TypeScript codemod");
      return { id: id(item.id), path: entry, touches: strings(item.touches, "codemod touches").map(value => safeRelative(value, true)) };
    }, "codemods");
    const migrations = list(row.migrations, value => {
      const item = object(value, ["id", "changesRows", "expansion", "contract", "dependsOn", "statusCommand", "completion", "instructions"], "migration");
      return { id: id(item.id), changesRows: bool(item.changesRows), expansion: string(item.expansion, "expansion release/commit"), contract: string(item.contract, "contract release"), dependsOn: strings(item.dependsOn, "migration dependencies"), statusCommand: strings(item.statusCommand, "read-only status command"), completion: string(item.completion, "completion predicate"), instructions: file(item.instructions) };
    }, "migrations");
    const env = list(row.env, value => {
      const item = object(value, ["name", "kind", "secret", "required", "replacement"], "environment change");
      const name = string(item.name, "env name"); demand(/^[A-Z_][A-Z0-9_]*$/.test(name), "Invalid env name");
      demand(["new", "removed", "renamed"].includes(String(item.kind)), "Unknown env change kind");
      const replacement = item.replacement === undefined ? undefined : string(item.replacement, "replacement env");
      if (replacement) demand(/^[A-Z_][A-Z0-9_]*$/.test(replacement), "Invalid replacement env name");
      demand(item.kind !== "renamed" || replacement, "Renamed env needs a replacement");
      return { name, kind: item.kind as EnvChange["kind"], secret: bool(item.secret), required: bool(item.required), replacement };
    }, "environment changes");
    const dependencyFloors = list(row.dependencyFloors, value => {
      const item = object(value, ["path", "name", "minimum", "optionalApp"], "dependency floor");
      const name = string(item.name, "dependency name"), minimum = string(item.minimum, "minimum dependency"); version(minimum);
      demand(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name), "Invalid dependency name");
      const manifest = file(item.path); demand(path.posix.basename(manifest) === "package.json", "Dependency floor needs a package.json path");
      return { path: manifest, name, minimum, optionalApp: optionalApp(item.optionalApp) };
    }, "dependency floors");
    const renamedExports = list(row.renamedExports, value => { const item = object(value, ["from", "to"], "renamed export"); return { from: string(item.from, "old export"), to: string(item.to, "new export") }; }, "renamed exports");
    const changedSeams = strings(row.changedSeams, "changed seams");
    demand(changedSeams.every(value => seams.some(seam => seam.id === value)), "Unknown changed seam ID");
    return { version: releaseVersion, previous, supportedBaseline, codemods, migrations, env, removedFiles: strings(row.removedFiles, "removed files").map(value => safeRelative(value)), renamedExports, dependencyFloors, changedSeams };
  }, "releases");
  demand(releases.length > 0, "Release history is empty"); unique(releases, row => row.version, "release version");
  for (let i = 0; i < releases.length; i++) {
    demand(i === 0 ? releases[i].previous === null : releases[i].previous === releases[i - 1].version && compare(releases[i - 1].version, releases[i].version) < 0, "Missing or unordered intermediate release history");
  }
  for (const kind of ["codemods", "migrations"] as const) {
    const definitions = new Map<string, string>();
    for (const release of releases) for (const item of release[kind]) {
      const before = definitions.get(item.id), definition = canonical(item);
      demand(!before || before === definition, "Stable step ID has conflicting definitions: " + item.id);
      definitions.set(item.id, definition);
    }
  }
  return { schemaVersion: 1, runtime: { nodeMajor: Number(runtime.nodeMajor), bun }, seams, releases };
}
export function parseAdvisories(text: string): AdvisoryManifest {
  const raw = object(JSON.parse(text), ["schemaVersion", "advisories"], "advisory manifest"); demand(raw.schemaVersion === 1, "Unsupported advisory schema");
  const advisories = list(raw.advisories, value => {
    const row = object(value, ["id", "severity", "affected", "fixed", "summary"], "advisory");
    demand(["low", "medium", "high", "critical"].includes(String(row.severity)), "Unknown advisory severity");
    const affected = string(row.affected, "affected range"), fixed = string(row.fixed, "fixed version"); version(fixed); satisfies(fixed, affected);
    demand(!satisfies(fixed, affected), "Advisory fixed version is still affected");
    return { id: id(row.id), severity: row.severity as Advisory["severity"], affected, fixed, summary: string(row.summary, "advisory summary") };
  }, "advisories");
  unique(advisories, row => row.id, "advisory ID");
  return { schemaVersion: 1, advisories };
}
