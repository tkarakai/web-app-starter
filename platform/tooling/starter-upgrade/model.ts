import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const SCHEMA = 1;
export const PACKAGE = "@web-app-starter/starter-sidebar-policy";
export const BOUNDARY = "starter-packages/sidebar-policy/";
export const MANIFEST = "starter-upgrade.json";
export const LOCK = "starter-upgrade.lock.json";
export const EVIDENCE = ".starter-upgrade/evidence.json";
export const ARTIFACT = ".next/server/app/dashboard.html";
export const PAYLOADS = ["package.json", "dist/index.js", "dist/index.d.ts"].map(p => BOUNDARY + p);
export const GENERATED = ["node_modules/", ".next/", "out/", ".turbo/", ".starter-upgrade/", "next-env.d.ts", "tsconfig.tsbuildinfo"];
export type Owner = "consumed" | "application" | "generated";
export type Hashes = Record<string, string>;
export interface Manifest { schemaVersion: number; package: string; ownership: Record<string, Owner> }
export interface Check { id: string; command: string[] }
export interface Release { files: Hashes; from: string[]; actions: string[]; affectedLayers: string[]; securityUrgency: string }
export interface Catalogue { schemaVersion: number; package: string; latest: string; releases: Record<string, Release> }
export interface Plan {
  schemaVersion: number; package: string; from: string; to: string; id: string;
  catalogueDigest: string; sourceDigest: string; toolDigest: string; lockDigest: string;
  affectedLayers: string[]; securityUrgency: string;
  changes: { path: string; before: string; after: string }[];
  actions: Check[]; verification: Check[];
}
export interface Lock {
  schemaVersion: number; package: string; release: string; releaseDigest: string; files: Hashes;
  status: "baseline" | "pending" | "verified"; plan?: Plan; evidenceDigest?: string;
}
export interface Evidence {
  schemaVersion: number; package: string; planId: string; sourceDigest: string; release: string;
  status: "failed" | "verified"; results: (Check & { exitCode: number; outputSha256: string })[];
  artifacts?: Hashes; error?: string;
}
export class UpgradeError extends Error {}
export function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new UpgradeError(message);
}
export function digest(data: string | Buffer): string { return createHash("sha256").update(data).digest("hex"); }
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => [k, sorted(v)]));
  return value;
}
export function encode(value: unknown): string { return JSON.stringify(sorted(value), null, 2) + "\n"; }
export function fingerprint(value: unknown): string { return digest(encode(value)); }
export function equal(a: unknown, b: unknown): boolean { return encode(a) === encode(b); }
export function matches(file: string, rule: string): boolean { return rule.endsWith("/") ? file.startsWith(rule) : file === rule; }
export function safePath(root: string, relative: string, allowHardlinks = false): string {
  requireThat(typeof relative === "string" && relative.length > 0 && !relative.includes("\\") && !relative.includes("\0"), "Empty/invalid path");
  const normalized = relative.replace(/\/$/, "");
  requireThat(!path.posix.isAbsolute(relative) && !normalized.split("/").some(p => !p || p === "." || p === ".."), `Unsafe path: ${relative}`);
  requireThat(path.resolve(root) === fs.realpathSync(root), `Symlink root or ancestor: ${root}`);
  let current = root;
  for (const part of normalized.split("/")) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch (error) { if ((error as { code?: string }).code === "ENOENT") continue; throw error; }
    requireThat(!stat.isSymbolicLink(), `Symlink path: ${relative}`);
    requireThat(allowHardlinks || !stat.isFile() || stat.nlink === 1, `Hardlinked path: ${relative}`);
  }
  return current;
}
export function readJson<T>(file: string): T {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  requireThat(value && typeof value === "object" && !Array.isArray(value), `Expected object: ${file}`);
  requireThat((value as { schemaVersion?: unknown }).schemaVersion === SCHEMA, `Unsupported schema: ${file}`);
  return value as T;
}
export function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, encode(value), { flag: "wx" });
  fs.renameSync(temporary, file);
}
export function manifest(app: string): Manifest {
  const value = readJson<Manifest>(safePath(app, MANIFEST));
  requireThat(value.package === PACKAGE, "Unsupported starter package");
  const rules = value.ownership;
  requireThat(rules && typeof rules === "object" && !Array.isArray(rules), "Missing ownership rules");
  for (const [file, owner] of Object.entries(rules)) {
    safePath(app, file);
    requireThat(["consumed", "application", "generated"].includes(owner), `Unsupported owner: ${owner}; vendoring is not supported`);
    requireThat(!GENERATED.some(g => matches(file, g)) || GENERATED.includes(file), "Cannot place source ownership inside generated paths");
    requireThat(owner !== "consumed" || file === BOUNDARY, "Only the sidebar package may be consumed");
    requireThat(owner !== "generated" || [...GENERATED, LOCK].includes(file), "Source cannot be hidden as generated");
    requireThat(!matches(file, BOUNDARY) || file === BOUNDARY, "Cannot override consumed ownership");
  }
  requireThat(GENERATED.every(p => rules[p] === "generated") && rules[LOCK] === "generated", "Generated paths are reserved");
  requireThat(rules[BOUNDARY] === "consumed" && rules[MANIFEST] === "application", "Missing ownership boundary");
  const pkg = JSON.parse(fs.readFileSync(safePath(app, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  requireThat(pkg.dependencies?.[PACKAGE] === `file:./${BOUNDARY.slice(0, -1)}`, "Demo must consume its local starter package, not workspace source");
  return value;
}
export function ownerOf(value: Manifest, file: string): Owner {
  const rules = Object.keys(value.ownership).filter(r => matches(file, r)).sort((a, b) => b.length - a.length);
  requireThat(rules.length, `Unclassified path: ${file}`);
  return value.ownership[rules[0]];
}
export function walk(root: string, relative = "", skip: string[] = []): string[] {
  const files: string[] = [];
  requireThat(path.resolve(root) === fs.realpathSync(root), `Symlink root or ancestor: ${root}`);
  for (const item of fs.readdirSync(relative ? safePath(root, relative) : root).sort()) {
    if (item === ".DS_Store") continue;
    const name = relative + item;
    if (skip.some(rule => matches(name, rule) || name + "/" === rule)) continue;
    // Bun may hardlink a local package into its generated dependency cache.
    // Consumed files are replaced by rename, never written through an alias.
    const file = safePath(root, name, matches(name, BOUNDARY));
    if (fs.statSync(file).isDirectory()) files.push(...walk(root, name + "/", skip));
    else { requireThat(fs.statSync(file).isFile(), `Not a regular file: ${name}`); files.push(name); }
  }
  return files;
}
export function installed(app: string): Hashes {
  requireThat(fs.existsSync(safePath(app, BOUNDARY)), "Missing consumed starter package");
  return Object.fromEntries(walk(app, BOUNDARY).map(p => [p, digest(fs.readFileSync(safePath(app, p, true)))]));
}
export function sourceFiles(app: string): Hashes {
  const value = manifest(app);
  const files = walk(app, "", [...GENERATED, LOCK]);
  return Object.fromEntries(files.filter(p => ownerOf(value, p) !== "consumed").map(p => [p, digest(fs.readFileSync(safePath(app, p)))]));
}
