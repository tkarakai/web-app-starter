#!/usr/bin/env node
/**
 * v2: adminEmails live in the platform component, outside the app data model.
 * Replace Doc<"adminEmails"> with the exported AdminEmail type and
 * Id<"adminEmails"> with string: component IDs are opaque across the boundary.
 * Only bindings imported from @repo/backend or the configured Convex data model
 * qualify; app types with the same name are left alone. Keeps Doc for other tables.
 *
 * Run from the repository root, with no install needed:
 *   ./platform/tooling/node-ts.sh platform/tooling/codemods/v2-admin-email-types.ts
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
    let currentImport = match[0];
    for (const binding of ["Doc", "Id"]) {
      const doc = parts.find((s) => new RegExp(`^\\s*(?:type\\s+)?${binding}(?:\\s+as\\s+[\\w$]+)?\\s*$`).test(s));
      if (!doc) continue;
      const local = /\bas\s+([\w$]+)/.exec(doc)?.[1] ?? binding;
      const usage = new RegExp(`(?<![\\w$.])${escape(local)}\\s*<\\s*(["'])adminEmails\\1\\s*>`, "g");
      const updated = result.replace(usage, binding === "Id" ? "string" : 'import("@repo/backend").AdminEmail');
      if (updated === result) continue;
      result = updated;
      if (!new RegExp(`(?<![\\w$])${escape(local)}(?![\\w$])`).test(result.replace(currentImport, ""))) {
        parts.splice(parts.indexOf(doc), 1);
        const remaining = parts.filter((s) => s.trim()).join(",");
        const nextImport = remaining ? match[0].replace(specifiers, () => remaining) : "";
        result = result.replace(currentImport, () => nextImport);
        currentImport = nextImport;
      }
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
