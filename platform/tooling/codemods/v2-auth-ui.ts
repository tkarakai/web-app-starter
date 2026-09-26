#!/usr/bin/env node
/**
 * v2: the web app's auth components moved to the platform package `@web-app-starter/auth-ui`.
 *
 * Why: auth pages and their logic (guards, the session-cookie redirects, the clear-session
 * route, sign-in locale handling) are security-sensitive platform code. Kept in an app, every
 * fix arrived as a merge conflict in files the app had touched; in the platform zone they are
 * taken wholesale on upgrade, and the app's route files only re-export them.
 *
 * What it rewrites, in app source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`) outside
 * `platform/`: import and `vi.mock` specifiers of the moved modules, which all used named
 * exports, to the package root:
 *   `@/components/auth/<auth-guard|guest-guard|force-system-theme|auth-form|...>`,
 *   `@/components/ui/locale-switcher`, `@/components/convex-error-toast`,
 *   `@/lib/<auth-broadcast|auth-callbacks|auth-locale>`  ->  `@web-app-starter/auth-ui`.
 * A specifier your app still has a file for (you kept a local copy) is left alone.
 *
 * It does not rewrite route files: take the starter's one-line re-exports for those.
 *
 * Usage (from the repository root, Node 22.6+, no install needed):
 *   ./platform/tooling/node-ts.sh platform/tooling/codemods/v2-auth-ui.ts [--check] [ROOT]
 * Then add `@web-app-starter/auth-ui` to the app's dependencies and run `bun install`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export const PACKAGE = "@web-app-starter/auth-ui";

/** App-relative module paths (after `@/`) that moved into the package. */
export const MOVED = [
  "components/auth/auth-form",
  "components/auth/auth-guard",
  "components/auth/force-system-theme",
  "components/auth/forgot-password-form",
  "components/auth/guest-guard",
  "components/auth/invitation-signup-form",
  "components/auth/reset-password-form",
  "components/auth/verify-email-form",
  "components/ui/locale-switcher",
  "components/convex-error-toast",
  "lib/auth-broadcast",
  "lib/auth-callbacks",
  "lib/auth-locale",
] as const;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRECTORIES = new Set([
  ".git", "node_modules", ".next", ".turbo", ".vercel", "out", "dist", "_generated", "coverage",
  "playwright-report", "test-results", "blob-report", ".ci-local-artifacts", ".convex", "platform",
]);

const alternatives = MOVED.map(item => item.replaceAll("/", "\\/")).join("|");
const SPECIFIER = new RegExp(`(["'])@\\/(${alternatives})\\1`, "g");

export interface RewriteResult { text: string; count: number }

/**
 * Rewrite one file. `hasLocalModule(modulePath)` says whether the app still has its own
 * copy of a moved module (then imports of it are kept).
 */
export function rewriteText(text: string, hasLocalModule: (modulePath: string) => boolean = () => false): RewriteResult {
  let count = 0;
  const next = text.replace(SPECIFIER, (match, quote: string, modulePath: string) => {
    if (hasLocalModule(modulePath)) return match;
    count += 1;
    return `${quote}${PACKAGE}${quote}`;
  });
  return { text: next, count };
}

export interface Options { root: string; check: boolean }
export interface Change { file: string; count: number }

function* sourceFiles(root: string, relative = ""): Generator<string> {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) yield* sourceFiles(root, name);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield name;
    }
  }
}

/** The app directory (holding `src/`) for a file such as `apps/web/qa/tests/x.test.tsx`. */
export function appDirectory(file: string): string | undefined {
  const parts = file.split("/");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    if (parts[index] === "src" || parts[index] === "qa") return parts.slice(0, index).join("/");
  }
  return undefined;
}

/** Rewrite (or, with `check`, only report) every app source file under `root`. */
export function migrate(options: Options): Change[] {
  const changes: Change[] = [];
  for (const file of sourceFiles(options.root)) {
    const absolute = path.join(options.root, file);
    const before = fs.readFileSync(absolute, "utf8");
    const app = appDirectory(file);
    const hasLocalModule = (modulePath: string): boolean => {
      if (app === undefined) return false;
      const base = path.join(options.root, app, "src", modulePath);
      return [".ts", ".tsx", ".js", ".jsx"].some(extension => fs.existsSync(`${base}${extension}`));
    };
    const result = rewriteText(before, hasLocalModule);
    if (result.count === 0 || result.text === before) continue;
    if (!options.check) fs.writeFileSync(absolute, result.text);
    changes.push({ file, count: result.count });
  }
  return changes;
}

const USAGE = `Usage: v2-auth-ui.ts [--check] [ROOT]
  ROOT      repository root (default: current directory)
  --check   report what would change, write nothing, exit 1 if anything would`;

export function parseArguments(argv: readonly string[]): Options | string {
  let root = ".";
  let check = false;
  let rootSeen = false;
  for (const argument of argv) {
    if (argument === "--check") check = true;
    else if (argument === "--help" || argument === "-h") return USAGE;
    else if (argument.startsWith("-") || rootSeen) return `unexpected argument: ${argument}\n${USAGE}`;
    else { root = argument; rootSeen = true; }
  }
  return { root: path.resolve(root), check };
}

export function main(argv: readonly string[], out: (line: string) => void = line => process.stdout.write(`${line}\n`)): number {
  const options = parseArguments(argv);
  if (typeof options === "string") {
    out(options);
    return options === USAGE ? 0 : 2;
  }
  if (!fs.existsSync(path.join(options.root, "package.json"))) {
    out(`v2-auth-ui: ${options.root} has no package.json; pass the repository root`);
    return 2;
  }
  const changes = migrate(options);
  const verb = options.check ? "would rewrite" : "rewrote";
  for (const change of changes) out(`${verb} ${change.count} import(s) in ${change.file}`);
  const total = changes.reduce((sum, change) => sum + change.count, 0);
  out(`v2-auth-ui: ${verb} ${total} import(s) in ${changes.length} file(s)`);
  if (!options.check && changes.length > 0) out(`Next: add ${PACKAGE} to each app's dependencies and transpilePackages, then run \`bun install\`.`);
  return options.check && changes.length > 0 ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
