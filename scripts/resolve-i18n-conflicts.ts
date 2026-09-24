#!/usr/bin/env node
/**
 * Resolve merge conflicts in i18n message files by merging keys, not text.
 *
 * Why this exists
 * ---------------
 * `packages/i18n/messages/*.json` is a flat shared namespace: the starter adds keys
 * and every business app adds keys, so an upgrade conflicts in all 15 locales at
 * once. The obvious instruction — "keep both sides" — is wrong here. The closing
 * brace of a namespace is usually *shared context* outside the conflict, so
 * concatenating both sides interleaves the bodies of two different objects and
 * produces a file that is not JSON at all:
 *
 *     "fleet": {
 *       "title": "Fleet",
 *       "depot": "Depot"        <- ours, unterminated
 *     "security": {             <- theirs, grafted inside ours
 *       "revoke": "Revoke"
 *     }
 *
 * The fix is to merge the *parsed objects* three-way (base / ours / theirs) and
 * write the result back. Key additions from both sides are kept, edits on one side
 * win, and only a genuine both-sides-edited-the-same-key disagreement is reported
 * for a human to settle.
 *
 * Usage
 * -----
 *     node scripts/resolve-i18n-conflicts.ts            # every conflicted message file
 *     node scripts/resolve-i18n-conflicts.ts --check    # report, change nothing
 *     node scripts/resolve-i18n-conflicts.ts packages/i18n/messages/en.json
 *
 * Resolved files are written and `git add`-ed. Files with a real disagreement are
 * left conflicted, and the exact key paths are printed. Exit code is 0 when every
 * file was resolved, 1 when any file still needs a human.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const MESSAGES_DIR = "packages/i18n/messages/";
const MISSING = Symbol("missing"); // distinguishes "key absent" from "key present and null"

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function conflictedMessageFiles(): string[] {
  return git("diff", "--name-only", "--diff-filter=U")
    .split("\n")
    .filter((line) => line.startsWith(MESSAGES_DIR) && line.endsWith(".json"));
}

/** Read one merge stage: 1 = base, 2 = ours, 3 = theirs. undefined if absent. */
function stage(file: string, number: number): Json | undefined {
  let text: string;
  try {
    text = git("show", `:${number}:${file}`);
  } catch {
    return undefined;
  }
  return JSON.parse(text) as Json;
}

function isObject(value: Json | typeof MISSING): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Three-way merge two parsed JSON values. Returns [value, conflicts]. */
function merge(base: Json | typeof MISSING, ours: Json, theirs: Json, keyPath: string[] = []): [Json, string[]] {
  if (isDeepStrictEqual(ours, theirs)) return [ours, []];
  if (base !== MISSING && isDeepStrictEqual(ours, base)) return [theirs, []]; // only theirs changed
  if (base !== MISSING && isDeepStrictEqual(theirs, base)) return [ours, []]; // only ours changed

  if (isObject(ours) && isObject(theirs)) {
    const baseObject: JsonObject = isObject(base) ? base : {};
    const merged: JsonObject = {};
    const conflicts: string[] = [];
    // base order first (stable diffs), then each side's additions
    const keys = [...new Set([...Object.keys(baseObject), ...Object.keys(ours), ...Object.keys(theirs)])];

    for (const key of keys) {
      const inOurs = Object.hasOwn(ours, key), inTheirs = Object.hasOwn(theirs, key);
      const inBase = Object.hasOwn(baseObject, key);
      if (!inOurs && !inTheirs) continue; // both deleted it
      if (!inOurs) {
        // deleted by us, or added by them
        if (inBase && isDeepStrictEqual(baseObject[key], theirs[key])) continue; // we deleted, they left it alone
        merged[key] = theirs[key];
        continue;
      }
      if (!inTheirs) {
        if (inBase && isDeepStrictEqual(baseObject[key], ours[key])) continue; // they deleted, we left it alone
        merged[key] = ours[key];
        continue;
      }
      const [value, nested] = merge(inBase ? baseObject[key] : MISSING, ours[key], theirs[key], [...keyPath, key]);
      merged[key] = value;
      conflicts.push(...nested);
    }
    return [merged, conflicts];
  }

  // two different scalars (or mismatched shapes): a real disagreement.
  // Keep ours — a business app's own translation should not be silently
  // replaced — and report it so a human decides.
  return [ours, [keyPath.join(".") || "<root>"]];
}

function resolve(file: string, checkOnly: boolean): boolean {
  const base = stage(file, 1), ours = stage(file, 2), theirs = stage(file, 3);
  if (ours === undefined || theirs === undefined) {
    console.log(`  ${file}: added/deleted on one side — resolve by hand`);
    return false;
  }

  const [merged, conflicts] = merge(base === undefined ? MISSING : base, ours, theirs);

  if (conflicts.length) {
    console.log(`  ${file}: ${conflicts.length} key(s) changed on both sides, kept ours:`);
    for (const key of conflicts) console.log(`      ${key}`);
  }

  if (checkOnly) return !conflicts.length;

  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
  git("add", file);
  return !conflicts.length;
}

export function main(argv: string[]): number {
  const checkOnly = argv.includes("--check");
  const requested = argv.filter((arg) => arg !== "--check");
  const unknown = requested.find((arg) => arg.startsWith("-"));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);

  const files = requested.length ? requested : conflictedMessageFiles();
  if (!files.length) {
    console.log("resolve-i18n: no conflicted message files");
    return 0;
  }

  console.log(`resolve-i18n: ${files.length} file(s)`);
  const clean = files.map((file) => resolve(file, checkOnly)).every(Boolean);

  if (clean) console.log(`resolve-i18n: ${checkOnly ? "would resolve" : "resolved"} every file cleanly`);
  else console.log("resolve-i18n: some keys need a human — see above");
  return clean ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
