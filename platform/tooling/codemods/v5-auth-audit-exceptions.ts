#!/usr/bin/env node
/** The auth stack moved to better-auth 1.7, which fixes GHSA-965c-763c-88jm, GHSA-r4xp-prcw-77qf
 * and GHSA-q84f-53jg-9ppm. While the Convex adapter held better-auth below 1.7, apps were told to
 * accept those three advisories in the app-owned `dependency-audit-exceptions.json`. The dependency
 * audit fails on an exception that no longer matches a finding, so after the upgrade they must go.
 * Removes only those three better-auth entries; every other exception stays, and an emptied file
 * keeps its `{ "exceptions": [] }` shape.
 * Run from the app root: node platform/tooling/codemods/v5-auth-audit-exceptions.ts [--check] [ROOT].
 * Dependency-free, idempotent; --check reports changes without writing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { openMigrationFile } from "./open-migration-file.ts";

const FILE = "dependency-audit-exceptions.json";
const FIXED = new Set(["GHSA-965c-763c-88jm", "GHSA-r4xp-prcw-77qf", "GHSA-q84f-53jg-9ppm"]);

/** The file's new content, or the same string when nothing applies. */
export function migrateContent(source: string): string {
  const parsed = JSON.parse(source) as { exceptions?: unknown };
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.exceptions)) return source;
  const kept = parsed.exceptions.filter(entry => {
    const row = entry as { advisory?: unknown; package?: unknown } | null;
    return !(row && row.package === "better-auth" && typeof row.advisory === "string" && FIXED.has(row.advisory));
  });
  if (kept.length === parsed.exceptions.length) return source;
  return JSON.stringify({ ...parsed, exceptions: kept }, null, 2) + "\n";
}

export function migrate(root: string, check = false): string[] {
  const fd = openMigrationFile(root, FILE, check);
  if (fd === undefined) return [];
  try {
    const source = fs.readFileSync(fd, "utf8");
    const content = migrateContent(source);
    if (content === source) return [];
    if (!check) { fs.writeSync(fd, content, 0, "utf8"); fs.ftruncateSync(fd, Buffer.byteLength(content)); }
    return [FILE];
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v5-auth-audit-exceptions.ts [--check] [ROOT]");
    const files = migrate(path.resolve(values[0] ?? "."), check);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need updating" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
