// Adopt the starter: turn a fresh clone into your app's repository. Run once, as `bun run adopt`.
//
//   bun run adopt                                   # asks for what it needs
//   bun run adopt --name "Acme" --repo acme/acme-app --yes
//
// Options:
//   --name <name>             Product name (app.config.ts identity.productName and legalEntity)
//   --support-email <email>   Support email (identity.supportEmail)
//   --cookie-prefix <prefix>  Better Auth cookie prefix (runtime.authCookiePrefix); default: from the name
//   --port <app>=<port>       Local port, repeatable (runtime.ports)
//   --repo <owner/name>       Your GitHub repository, for the Renovate preset link; default: from origin
//   --remove <apps>           Comma-separated reference apps to delete: landing, landing-static, demo
//   --no-upstream             Don't add the `upstream` remote
//   --skip-install            Don't run `bun install` after removing apps
//   --skip-build              Don't run the build at the end
//   --yes                     Don't ask; use the options and defaults
//
// Steps (repo-separation §9): set values in app.config.ts; replace the root README, LICENSE,
// AGENTS.md and CLAUDE.md with platform/templates; point renovate.json at your repository and
// drop its product-repo-only rules; optionally remove reference apps; link platform skills into
// .claude/skills and .agents/skills; write .platform-base.json and add the upstream remote; run
// the zone check and a build; print what is yours and what is the platform's.
// It never edits the platform zone.
import { execFileSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { BASE_FILE, SEAM_HOOKS, checkZone, type PlatformBase } from "./check-zone.ts";

export const STARTER_REPO = "tkarakai/web-app-starter";
export const STARTER_URL = `https://github.com/${STARTER_REPO}.git`;
export const REMOVABLE_APPS = ["landing", "landing-static", "demo"] as const;
export type RemovableApp = (typeof REMOVABLE_APPS)[number];
const PORT_APPS = ["landing", "web", "admin", "storybook", "landing-static"] as const;
const TEMPLATES = ["README.md", "LICENSE", "AGENTS.md", "CLAUDE.md"] as const;
const SKILL_DIRS = [".claude/skills", ".agents/skills"] as const;

export type AdoptOptions = {
  name: string;
  supportEmail?: string;
  cookiePrefix?: string;
  ports?: Record<string, number>;
  repo: string;
  remove?: RemovableApp[];
  upstream?: boolean;
  install?: boolean;
  build?: boolean;
};

/** "Acme Tasks!" → "acme-tasks": a cookie-safe default prefix. */
export function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
}

function replaceOnce(text: string, pattern: RegExp, replacement: string | ((match: string, indent: string) => string), what: string): string {
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`));
  if (matches?.length !== 1) {
    throw new Error(`app.config.ts: expected one ${what} (${pattern}), found ${matches?.length ?? 0}. Set it by hand and rerun with its current value`);
  }
  // Replacement strings interpret $&, $`, $' and $n. User values must stay literal.
  return text.replace(pattern, typeof replacement === "string" ? () => replacement : replacement);
}

/** Set name, support email, cookie prefix and ports in the text of app.config.ts. */
export function setAppConfig(text: string, options: Pick<AdoptOptions, "name" | "supportEmail" | "cookiePrefix" | "ports">): string {
  let out = replaceOnce(text, /^const productName = .*;$/m, `const productName = ${JSON.stringify(options.name)};`, "productName");
  if (options.supportEmail !== undefined) {
    out = replaceOnce(out, /^const supportEmail = .*;$/m, `const supportEmail = ${JSON.stringify(options.supportEmail)};`, "supportEmail");
  }
  const prefix = options.cookiePrefix ?? slug(options.name);
  out = replaceOnce(out, /^(\s*)authCookiePrefix: .*,$/m, (_match, indent) => `${indent}authCookiePrefix: ${JSON.stringify(prefix)},`, "authCookiePrefix");
  for (const [app, port] of Object.entries(options.ports ?? {})) {
    if (!(PORT_APPS as readonly string[]).includes(app)) throw new Error(`--port: unknown app "${app}" (one of ${PORT_APPS.join(", ")})`);
    const key = app.includes("-") ? `"${app}"` : app;
    out = replaceOnce(out, new RegExp(`^(\\s*)${key}: \\d+,$`, "m"), (_match, indent) => `${indent}${key}: ${port},`, `ports.${app}`);
  }
  return out;
}

/** Point the Renovate preset link at the app's repository and drop the product-repo-only rules. */
export function rewriteRenovate(text: string, repo: string): string {
  const config = JSON.parse(text) as { extends?: string[]; ignorePaths?: string[]; packageRules?: { matchFileNames?: string[] }[] };
  config.extends = (config.extends ?? []).map((preset) =>
    preset.replace(`local>${STARTER_REPO}//`, `local>${repo}//`));
  // The product repo overrides the preset's ignorePaths to let Renovate update platform/; an app
  // keeps the preset's, which ignore platform/**.
  if (config.ignorePaths?.some((entry) => !entry.startsWith("platform"))) delete config.ignorePaths;
  if (config.packageRules) {
    config.packageRules = config.packageRules.filter((rule) =>
      !(rule.matchFileNames?.length === 1 && rule.matchFileNames[0] === "platform/**"));
    if (config.packageRules.length === 0) delete config.packageRules;
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Parse `owner/name` from a GitHub remote URL. */
export function repoFromUrl(url: string): string | undefined {
  return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1];
}

/** Remove a top-level `  <job>:` block from a workflow and its name from `needs:` lists. */
export function removeWorkflowJob(text: string, job: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line === `  ${job}:`) { skipping = true; continue; }
    if (skipping) {
      if (/^ {2}\S/.test(line) || /^\S/.test(line)) skipping = false;
      else continue;
    }
    out.push(line);
  }
  const escaped = job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return out.join("\n")
    .replace(new RegExp(`(needs: \\[[^\\]]*?), ${escaped}(?=[,\\]])`, "g"), "$1")
    .replace(new RegExp(`(needs: \\[)${escaped}, `, "g"), "$1")
    .replace(/\n{3,}/g, "\n\n");
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Delete reference apps and their app-owned wiring (callers, scripts, tsconfig and Turbo entries). */
export function removeApps(root: string, apps: readonly RemovableApp[], log: (line: string) => void): void {
  if (apps.length === 0) return;
  const at = (file: string): string => path.join(root, file);
  const pkg = readJson<{ scripts?: Record<string, string> }>(at("package.json"));
  const tsconfigText = readOptional(at("tsconfig.json"));
  const turboText = readOptional(at("turbo.json"));
  const turbo = turboText === undefined ? undefined : JSON.parse(turboText) as { tasks?: Record<string, unknown> };
  let tsconfig = tsconfigText;
  const verify = at(".github/workflows/ci-verify.yml");
  let verifyText = readOptional(verify);

  for (const app of apps) {
    rmSync(at(`apps/${app}`), { recursive: true, force: true });
    rmSync(at(`.github/workflows/ci-${app}.yml`), { force: true });
    for (const script of Object.keys(pkg.scripts ?? {})) {
      if (script === `dev:${app}`) delete pkg.scripts?.[script];
    }
    if (tsconfig) {
      tsconfig = tsconfig.split("\n").filter((line) => !line.includes(`"path": "apps/${app}"`)).join("\n");
    }
    for (const task of Object.keys(turbo?.tasks ?? {})) {
      if (task.startsWith(`@repo/${app}#`)) delete turbo?.tasks?.[task];
    }
    if (verifyText) verifyText = removeWorkflowJob(verifyText, app);
    log(`  - removed apps/${app} and its caller workflow, scripts and build entries`);
  }
  writeJson(at("package.json"), pkg);
  if (turbo) writeJson(at("turbo.json"), turbo);
  if (tsconfig !== undefined) {
    tsconfig = tsconfig.replace(/,(\s*\n\s*\])/g, "$1");
    JSON.parse(tsconfig); // fail loudly rather than leave a broken seam
    writeFileSync(at("tsconfig.json"), tsconfig);
  }
  if (verifyText !== undefined) writeFileSync(verify, verifyText);
}

/** Link every platform skill into .claude/skills and .agents/skills; drop links to removed skills. */
export function linkSkills(root: string): string[] {
  const source = path.join(root, "platform/agent-skills");
  const skills = existsSync(source)
    ? readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
  for (const dir of SKILL_DIRS) {
    const full = path.join(root, dir);
    mkdirSync(full, { recursive: true });
    for (const entry of readdirSync(full)) {
      const link = path.join(full, entry);
      if (entry.startsWith("platform-") && lstatSync(link).isSymbolicLink() && !skills.includes(entry)) unlinkSync(link);
    }
    for (const skill of skills) {
      const link = path.join(full, skill);
      const target = `../../platform/agent-skills/${skill}`;
      if (existsSync(link) || isLink(link)) {
        if (isLink(link) && readlinkSync(link) === target) continue;
        rmSync(link, { recursive: true, force: true });
      }
      symlinkSync(target, link);
    }
  }
  return skills;
}

function isLink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function run(root: string, command: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
}

// Build-time placeholders, as in local CI (ci-local.sh): the real values are only read at runtime,
// and a fresh clone has no Convex deployment yet.
const BUILD_PLACEHOLDERS: Record<string, string> = {
  CONVEX_URL: process.env.CONVEX_URL ?? "https://placeholder.convex.cloud",
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL ?? "https://placeholder.convex.site",
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud",
  NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://placeholder.convex.site",
};

/** Run every adoption step on `root`. Returns the zone check's error count. */
export function adopt(root: string, options: AdoptOptions, log: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): number {
  const at = (file: string): string => path.join(root, file);
  if (existsSync(at(BASE_FILE))) throw new Error(`${BASE_FILE} exists: this repository is already adopted`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error(`--repo must be owner/name (got "${options.repo}")`);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const version = readFileSync(at("platform/VERSION"), "utf8").trim();

  log("1. app.config.ts");
  writeFileSync(at("app.config.ts"), setAppConfig(readFileSync(at("app.config.ts"), "utf8"), options));

  log("2. Root files from platform/templates");
  for (const file of TEMPLATES) {
    const text = readFileSync(at(`platform/templates/${file}`), "utf8").replaceAll("<Product name>", options.name);
    writeFileSync(at(file), text);
    log(`  - ${file}`);
  }
  writeFileSync(at("renovate.json"), rewriteRenovate(readFileSync(at("renovate.json"), "utf8"), options.repo));
  log(`  - renovate.json extends local>${options.repo}//platform/config/renovate-preset`);

  log("3. Reference apps");
  const remove = options.remove ?? [];
  if (remove.length === 0) log("  - kept all");
  if (remove.includes("landing") || remove.includes("demo")) {
    log("  ! The platform CD workflows still deploy landing, and CI Shared rehearses upgrades on demo.");
    log("    Until a release makes them optional, those workflow jobs fail without the apps.");
  }
  removeApps(root, remove, log);
  if (remove.length > 0 && options.install !== false) run(root, "bun", ["install"]);

  log("4. Platform skills");
  const skills = linkSkills(root);
  log(`  - linked ${skills.length} into ${SKILL_DIRS.join(" and ")}`);

  log("5. Base record");
  const base: PlatformBase = { version, commit, patches: [] };
  writeJson(at(BASE_FILE), base);
  log(`  - ${BASE_FILE}: platform ${version} at ${commit.slice(0, 12)}`);
  if (options.upstream !== false) {
    const remotes = git(root, ["remote"]).split("\n");
    if (remotes.includes("upstream")) log("  - upstream remote already set");
    else {
      git(root, ["remote", "add", "upstream", STARTER_URL]);
      log(`  - added upstream remote ${STARTER_URL}`);
    }
  }

  log("6. Platform updates");
  log("  - Automatic update delivery isn't part of this release. Take releases with platform/UPGRADING.md.");

  log("7. Checks");
  const zone = checkZone(root);
  for (const error of zone.errors) log(`  error: ${error}`);
  log(zone.errors.length === 0 ? "  - zone check passed" : `  - zone check: ${zone.errors.length} problem(s)`);
  if (options.build !== false && zone.errors.length === 0) run(root, "bun", ["run", "build"], BUILD_PLACEHOLDERS);

  log("");
  log("Yours (edit freely): apps/, packages/backend/convex/ outside platform/, the root files.");
  log(`Seams (yours, keep the platform's hooks): app.config.ts, ${SEAM_HOOKS.map((seam) => seam.file).join(", ")}, turbo.json, package.json.`);
  log("The platform's (never edit; replaced on upgrade): platform/, packages/backend/convex/platform/, .github/workflows/platform-*.yml, .claude/skills/platform-*, .agents/skills/platform-*.");
  log("Next: fill in the <placeholders> in README.md and AGENTS.md, review the diff, and commit.");
  return zone.errors.length;
}

type Parsed = Partial<AdoptOptions> & { yes: boolean };

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    switch (arg) {
      case "--name": parsed.name = value(); break;
      case "--support-email": parsed.supportEmail = value(); break;
      case "--cookie-prefix": parsed.cookiePrefix = value(); break;
      case "--repo": parsed.repo = value(); break;
      case "--port": {
        const [app, port] = value().split("=");
        if (!app || !/^\d+$/.test(port ?? "")) throw new Error("--port takes <app>=<port>");
        parsed.ports = { ...parsed.ports, [app]: Number(port) };
        break;
      }
      case "--remove": parsed.remove = parseRemove(value()); break;
      case "--no-upstream": parsed.upstream = false; break;
      case "--skip-install": parsed.install = false; break;
      case "--skip-build": parsed.build = false; break;
      case "--yes": parsed.yes = true; break;
      default: throw new Error(`unknown option ${arg}`);
    }
  }
  return parsed;
}

function parseRemove(list: string): RemovableApp[] {
  const apps = list.split(",").map((app) => app.trim()).filter(Boolean);
  for (const app of apps) {
    if (!(REMOVABLE_APPS as readonly string[]).includes(app)) throw new Error(`--remove: "${app}" is not one of ${REMOVABLE_APPS.join(", ")}`);
  }
  return apps as RemovableApp[];
}

async function main(argv: readonly string[]): Promise<number> {
  const root = process.cwd();
  const parsed = parseArgs(argv);
  let origin: string | undefined;
  try {
    origin = repoFromUrl(git(root, ["remote", "get-url", "origin"]));
  } catch {
    origin = undefined;
  }
  const defaultRepo = origin && origin !== STARTER_REPO ? origin : undefined;
  if (!parsed.yes && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (question: string, fallback?: string): Promise<string | undefined> => {
      const answer = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
      return answer || fallback;
    };
    parsed.name ??= await ask("Product name");
    parsed.supportEmail ??= await ask("Support email (blank keeps the placeholder)");
    parsed.cookiePrefix ??= await ask("Auth cookie prefix", slug(parsed.name ?? "app"));
    parsed.repo ??= await ask("Your GitHub repository (owner/name)", defaultRepo);
    parsed.remove ??= parseRemove(await ask(`Reference apps to remove (${REMOVABLE_APPS.join(", ")}; blank keeps all)`) ?? "");
    rl.close();
  }
  parsed.repo ??= defaultRepo;
  if (!parsed.name) throw new Error("--name is required");
  if (!parsed.repo) throw new Error(`--repo is required (origin is ${origin ?? "not set"}; name your own repository)`);
  return adopt(root, { ...parsed, name: parsed.name, repo: parsed.repo }) === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: unknown) => {
    process.stderr.write(`adopt: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
