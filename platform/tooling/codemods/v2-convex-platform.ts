#!/usr/bin/env node
/**
 * v2: platform Convex functions moved to `packages/backend/convex/platform/`.
 *
 * Why: v2 separates the platform (owned by the starter, replaced wholesale on
 * upgrade) from the app built on it. The backend is one Convex project, so the
 * split happens inside it: platform modules (auth, user profiles, sessions,
 * rate limits, audit trail, settings, announcements, waitlist, invitations,
 * admin, bootstrap, dev and E2E fixtures) now live in `convex/platform/`, and
 * the app's own modules (the sample domain `projects`, `tasks`, `files`, and
 * anything you added) stay at the `convex/` root. Convex derives function paths
 * from file paths, so every reference to a moved module changes:
 * `api.<module>.<fn>` is now `api.platform.<module>.<fn>` for every moved module.
 *
 * What it rewrites, in every text file of an app tree:
 *   1. Function references: `api.<module>` and `internal.<module>` ->
 *      `api.platform.<module>` / `internal.platform.<module>`, for the moved
 *      modules only. `components.*`, `ctx.auth`, `auth.api.*` and your own
 *      modules are left alone.
 *   2. CLI function paths: `convex run <module>:<fn>` ->
 *      `convex run platform/<module>:<fn>`.
 *   3. Relative imports inside the Convex directory that resolve to a moved
 *      module: `import { authedQuery } from "./functions"` ->
 *      `from "./platform/functions"` (computed per file, so `../functions` in a
 *      subdirectory works too).
 *
 * Idempotent: rewritten references name `platform`, which is not a moved module.
 * Directories named `platform/` are skipped (they arrive already migrated);
 * pass `--include-platform` only when migrating the starter itself.
 *
 * Usage (from the repository root, Node 22.6+, no install needed):
 *   ./platform/tooling/node-ts.sh platform/tooling/codemods/v2-convex-platform.ts \
 *     [--check] [--include-platform] [--convex-dir packages/backend/convex] [ROOT]
 * Then regenerate the Convex API (`bun run dev`, or `bunx convex codegen`).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/** Convex modules that moved from `convex/<module>.ts` to `convex/platform/<module>.ts`. */
export const MOVED_MODULES = [
  "adminAuth",
  "adminEmails",
  "adminInvitationActions",
  "adminInvitations",
  "announcements",
  "appSettings",
  "auditTrail",
  "auditTrailConstants",
  "auditTrailHelpers",
  "auth",
  "bootstrap",
  "developmentOnly",
  "devSeed",
  "devTotp",
  "e2eFixtures",
  "emailTemplates",
  "functions",
  "integrations",
  "meta",
  "onboardingType",
  "parseUserAgent",
  "passwordStrength",
  "rateLimits",
  "securityPolicies",
  "sendAuthEmail",
  "sessions",
  "tokenHash",
  "userProfiles",
  "waitlist",
  "waitlistActions",
  "waitlistTokens",
] as const;

/** Moved directories (local components) that relative imports may point into. */
export const MOVED_DIRECTORIES = ["betterAuth"] as const;

export const DEFAULT_CONVEX_DIR = "packages/backend/convex";

const names = MOVED_MODULES.join("|");
// `api.<module>` / `internal.<module>` as a standalone reference: not `auth.api.x`,
// `foo.internal.x` or `myapi.x`, and not a longer module name such as `api.authors`.
const REFERENCE = new RegExp(`(?<![\\w$.])(api|internal)\\.(${names})(?![\\w$])`, "g");
// `convex run <module>` or `convex run <module>:<fn>`, optionally after flags.
const CLI_PATH = new RegExp(`(convex run(?:\\s+--?[\\w-]+)*\\s+['"]?)(${names})(?=[:\\s'"]|$)`, "gm");
// Static and dynamic import specifiers, `export ... from`, `vi.mock(...)`.
const SPECIFIER = /((?:\bfrom|\bimport|\bmock)\s*\(?\s*)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".md", ".mdx", ".yml", ".yaml", ".sh",
]);
const SKIP_DIRECTORIES = new Set([
  ".git", "node_modules", ".next", ".turbo", ".vercel", "out", "dist", "_generated", "coverage",
  "playwright-report", "test-results", "blob-report", ".ci-local-artifacts", ".convex",
]);
const SKIP_FILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

export interface RewriteResult { text: string; count: number }

const MODULE_SET: ReadonlySet<string> = new Set<string>(MOVED_MODULES);
const DIRECTORY_SET: ReadonlySet<string> = new Set<string>(MOVED_DIRECTORIES);

/**
 * Where a relative specifier in `fileDirectory` points, if it is a moved module
 * or into a moved directory, as a new specifier; otherwise undefined. Paths are
 * POSIX and relative to the repository root.
 */
export function movedSpecifier(specifier: string, fileDirectory: string, convexDir: string): string | undefined {
  const target = path.posix.normalize(path.posix.join(fileDirectory, specifier));
  const relativeToConvex = path.posix.relative(convexDir, target);
  if (relativeToConvex.startsWith("..") || relativeToConvex === "") return undefined;
  const [first, ...rest] = relativeToConvex.split("/");
  const moduleName = rest.length === 0 ? first.replace(/\.(?:js|ts)$/, "") : undefined;
  const moved = (moduleName !== undefined && MODULE_SET.has(moduleName)) || (rest.length > 0 && DIRECTORY_SET.has(first));
  if (!moved) return undefined;
  let next = path.posix.relative(fileDirectory, path.posix.join(convexDir, "platform", relativeToConvex));
  if (!next.startsWith(".")) next = `./${next}`;
  return next;
}

/**
 * Apply the rewrite rules to one file's text. `file` is its repository-relative
 * POSIX path; rule 3 runs only for files inside `convexDir`.
 */
export function rewriteText(text: string, file: string, convexDir: string = DEFAULT_CONVEX_DIR): RewriteResult {
  let count = 0;
  let next = text.replace(REFERENCE, (_match, root: string, name: string) => {
    count += 1;
    return `${root}.platform.${name}`;
  });
  next = next.replace(CLI_PATH, (_match, before: string, name: string) => {
    count += 1;
    return `${before}platform/${name}`;
  });
  const inConvex = file.startsWith(`${convexDir}/`) && !file.startsWith(`${convexDir}/_generated/`);
  if (inConvex) {
    const directory = path.posix.dirname(file);
    next = next.replace(SPECIFIER, (match, before: string, quote: string, specifier: string) => {
      const moved = movedSpecifier(specifier, directory, convexDir);
      if (moved === undefined) return match;
      count += 1;
      return `${before}${quote}${moved}${quote}`;
    });
  }
  return { text: next, count };
}

export interface Options { root: string; check: boolean; includePlatform: boolean; convexDir: string }
export interface Change { file: string; count: number }

function* textFiles(root: string, relative = ""): Generator<string> {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) yield* textFiles(root, name);
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name) && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      yield name;
    }
  }
}

/** True for files in the platform zone: under any directory named `platform`. */
export function inPlatformZone(file: string): boolean {
  return file.split("/").slice(0, -1).includes("platform");
}

/** Rewrite (or, with `check`, only report) every file under `root`. */
export function migrate(options: Options): Change[] {
  const changes: Change[] = [];
  for (const file of textFiles(options.root)) {
    if (inPlatformZone(file) && !options.includePlatform) continue;
    const absolute = path.join(options.root, file);
    const before = fs.readFileSync(absolute, "utf8");
    const result = rewriteText(before, file, options.convexDir);
    if (result.count === 0 || result.text === before) continue;
    if (!options.check) fs.writeFileSync(absolute, result.text);
    changes.push({ file, count: result.count });
  }
  return changes;
}

const USAGE = `Usage: v2-convex-platform.ts [--check] [--include-platform] [--convex-dir DIR] [ROOT]
  ROOT                 repository root (default: current directory)
  --check              report what would change, write nothing, exit 1 if anything would
  --include-platform   also rewrite platform/ directories (starter maintainers only)
  --convex-dir DIR     the Convex functions directory, relative to ROOT (default: ${DEFAULT_CONVEX_DIR})`;

export function parseArguments(argv: readonly string[]): Options | string {
  let root = ".";
  let check = false;
  let includePlatform = false;
  let convexDir = DEFAULT_CONVEX_DIR;
  let rootSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") check = true;
    else if (argument === "--include-platform") includePlatform = true;
    else if (argument === "--convex-dir") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) return `--convex-dir needs a directory\n${USAGE}`;
      convexDir = path.posix.normalize(value.replaceAll("\\", "/")).replace(/\/$/, "");
      index += 1;
    } else if (argument === "--help" || argument === "-h") return USAGE;
    else if (argument.startsWith("-") || rootSeen) return `unexpected argument: ${argument}\n${USAGE}`;
    else { root = argument; rootSeen = true; }
  }
  return { root: path.resolve(root), check, includePlatform, convexDir };
}

export function main(argv: readonly string[], out: (line: string) => void = line => process.stdout.write(`${line}\n`)): number {
  const options = parseArguments(argv);
  if (typeof options === "string") {
    out(options);
    return options === USAGE ? 0 : 2;
  }
  if (!fs.existsSync(path.join(options.root, "package.json"))) {
    out(`v2-convex-platform: ${options.root} has no package.json; pass the repository root`);
    return 2;
  }
  const changes = migrate(options);
  const verb = options.check ? "would rewrite" : "rewrote";
  for (const change of changes) out(`${verb} ${change.count} reference(s) in ${change.file}`);
  const total = changes.reduce((sum, change) => sum + change.count, 0);
  out(`v2-convex-platform: ${verb} ${total} reference(s) in ${changes.length} file(s)`);
  if (!options.check && changes.length > 0) out("Next: regenerate the Convex API (`bun run dev` or `bunx convex codegen`).");
  return options.check && changes.length > 0 ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
