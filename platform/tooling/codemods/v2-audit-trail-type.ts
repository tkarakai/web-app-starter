#!/usr/bin/env node
/**
 * v2: audit events live in the platform component, outside the app data model.
 * Replace Doc<"auditTrail"> with the backend's exported AuditTrailEvent type.
 * Only bindings imported from @repo/backend or the configured Convex data model
 * qualify; app types with the same name are left alone. Keeps Doc for other tables.
 *
 * Run from the repository root, with no install needed:
 *   ./platform/tooling/node-ts.sh platform/tooling/codemods/v2-audit-trail-type.ts
 *   [--check] [--convex-dir packages/backend/convex] [ROOT]
 * Idempotent. --check writes nothing and exits 1 if changes are needed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const SKIP = new Set([".git", "node_modules", "platform", "_generated", ".next", ".turbo", ".convex", ".vercel", "dist", "out", "coverage", "test-results"]);
const IMPORT = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+(["'])([^"']+)\2\s*;?/g;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function rewriteText(text: string, file: string, root: string, convexDir = "packages/backend/convex"): string {
  let result = text;
  for (const match of text.matchAll(IMPORT)) {
    const [, specifiers, , source] = match;
    const model = path.resolve(path.dirname(file), source).replace(/\.(?:ts|js)$/, "");
    if (source !== "@repo/backend" && model !== path.resolve(root, convexDir, "_generated/dataModel")) continue;
    const parts = specifiers.split(",");
    const doc = parts.find((s) => /^\s*(?:type\s+)?Doc(?:\s+as\s+[\w$]+)?\s*$/.test(s));
    if (!doc) continue;
    const local = /\bas\s+([\w$]+)/.exec(doc)?.[1] ?? "Doc";
    const usage = new RegExp(`(?<![\\w$.])${escape(local)}\\s*<\\s*(["'])auditTrail\\1\\s*>`, "g");
    const updated = result.replace(usage, 'import("@repo/backend").AuditTrailEvent');
    if (updated === result) continue;
    result = updated;
    // Remove only an unused Doc import; other imported names and other table uses stay.
    if (!new RegExp(`(?<![\\w$])${escape(local)}(?![\\w$])`).test(result.replace(match[0], ""))) {
      const remaining = parts.filter((s) => s !== doc && s.trim()).join(",");
      result = result.replace(match[0], remaining ? match[0].replace(specifiers, remaining) : "");
    }
  }
  return result;
}

export function migrate(root: string, check = false, convexDir = "packages/backend/convex"): string[] {
  const changed: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(file);
      } else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) {
        const before = fs.readFileSync(file, "utf8");
        const after = rewriteText(before, file, root, convexDir);
        if (before !== after) {
          changed.push(path.relative(root, file));
          if (!check) fs.writeFileSync(file, after);
        }
      }
    }
  }
  walk(root);
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let root = process.cwd();
  let convexDir = "packages/backend/convex";
  let check = false;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--check") check = true;
    else if (arg === "--convex-dir") {
      const value = process.argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--convex-dir requires a path");
      convexDir = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else root = path.resolve(arg);
  }
  const changed = migrate(root, check, convexDir);
  for (const file of changed) console.log(`${check ? "Would update" : "Updated"}: ${file}`);
  console.log(`${changed.length} file(s) ${check ? "need changes" : "updated"}.`);
  if (check && changed.length) process.exitCode = 1;
}
