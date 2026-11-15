#!/usr/bin/env node
/** Security fix (#386): the web app's proxy skipped requests carrying `next-router-prefetch` or
 * `purpose: prefetch`. Those headers are client-controlled, so any client could send them to bypass
 * the page rate limit and the security headers. v5.0.0 removes the exemption, and the platform
 * contract `proxy-prefetch.test.ts` (part of `test:contracts`) requires every page request to reach
 * the proxy. `apps/web/src/proxy.ts` is app-owned, so the upgrade does not replace it.
 * Removes only the stock `missing: [ ...prefetch headers... ]` matcher exemption shipped from v2.0.0
 * to v4.1.0; a changed matcher is the app's own and must be reviewed by hand.
 * Run from the app root: node platform/tooling/codemods/v5-proxy-prefetch-rate-limit.ts [--check] [FILE].
 * FILE defaults to apps/web/src/proxy.ts. Dependency-free, idempotent; --check writes nothing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { openMigrationFile } from "./open-migration-file.ts";

const EXEMPTION = new RegExp([
  String.raw`^([ \t]*)missing: \[\r?\n`,
  String.raw`[ \t]*\{ type: "header", key: "next-router-prefetch" \},\r?\n`,
  String.raw`[ \t]*\{ type: "header", key: "purpose", value: "prefetch" \},\r?\n`,
  String.raw`[ \t]*\],[ \t]*(\r?\n)`,
].join(""), "m");

/** The proxy's new content, or the same string when nothing applies. */
export function migrateContent(source: string): string {
  return source.replace(EXEMPTION, (_match, indent: string, eol: string) =>
    `${indent}// Prefetch headers are client-controlled: page requests must share the rate limit.${eol}`);
}

export function migrate(root: string, check = false, file = "apps/web/src/proxy.ts"): string[] {
  const fd = openMigrationFile(root, file, check);
  if (fd === undefined) return [];
  try {
    const source = fs.readFileSync(fd, "utf8");
    const content = migrateContent(source);
    if (content === source) return [];
    if (!check) { fs.writeSync(fd, content, 0, "utf8"); fs.ftruncateSync(fd, Buffer.byteLength(content)); }
    return [file];
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), check = args.includes("--check"), values = args.filter(arg => arg !== "--check");
    if (values.length > 1 || values.some(arg => arg.startsWith("--"))) throw Error("Usage: v5-proxy-prefetch-rate-limit.ts [--check] [FILE]");
    const files = migrate(process.cwd(), check, values[0]);
    for (const file of files) console.log((check ? "Would update " : "Updated ") + file);
    console.log(files.length + " file(s) " + (check ? "need updating" : "updated"));
    if (check && files.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
