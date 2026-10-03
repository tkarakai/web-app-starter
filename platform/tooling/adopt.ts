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
//   --remove <apps>           Comma-separated reference apps to delete: demo
//   --remove-sample           Remove projects, tasks and uploads; keep account settings and auth
//   --from-release <vX.Y.Z>  Verify this published source after an existing-repository merge
//   --no-upstream             Don't add the `upstream` remote
//   --skip-install            Don't run `bun install` after removing apps
//   --skip-build              Don't run the build at the end
//   --pr-e2e <mode>           When CI runs E2E on pull requests: always, on-demand or off. Asked on a
//                             private repository (Actions minutes are metered); sets PLATFORM_CI_PR_E2E
//   --yes                     Don't ask; use the options and defaults
//
// Steps (repo-separation §9): set values in app.config.ts; replace the root README, LICENSE,
// AGENTS.md and CLAUDE.md with platform/templates; point renovate.json at your repository and
// drop its product-repo-only rules; optionally remove reference apps; link platform skills into
// .claude/skills and .agents/skills; write .platform-base.json and add the upstream remote; run
// the zone check and a build; print what is yours and what is the platform's.
// It never edits the platform zone.
import { execFile, execFileSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { BASE_FILE, SEAM_HOOKS, checkZone, type PlatformBase } from "./check-zone.ts";
import { adoptionRelease, commandAt, type Command } from "./adopt-release.ts";
import { applyPrE2e, describeModes, isMode, manualCommand, needsChoice, prE2eStatus, type Exec, type Mode } from "./ci-pr-e2e-setup.ts";

export const STARTER_REPO = "tkarakai/web-app-starter";
export const STARTER_URL = `https://github.com/${STARTER_REPO}.git`;
export const REMOVABLE_APPS = ["demo"] as const;
export type RemovableApp = (typeof REMOVABLE_APPS)[number];
const PORT_APPS = ["landing", "web", "admin", "storybook"] as const;
const TEMPLATES = ["README.md", "LICENSE", "AGENTS.md", "CLAUDE.md"] as const;
const SKILL_DIRS = [".claude/skills", ".agents/skills"] as const;

export type AdoptOptions = {
  name: string;
  supportEmail?: string;
  cookiePrefix?: string;
  ports?: Record<string, number>;
  repo: string;
  remove?: RemovableApp[];
  removeSample?: boolean;
  upstream?: boolean;
  install?: boolean;
  build?: boolean;
  fromRelease?: string;
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

/** Strip the shipped sample from a fresh checkout, keeping the platform schema hook and account UI. */
export function removeSample(root: string): void {
  const at = (file: string): string => path.join(root, file);
  const backend = "packages/backend/convex/";
  const dashboard = "apps/web/src/app/[locale]/(dashboard)/dashboard/";
  const schema = readFileSync(at(`${backend}schema.ts`), "utf8")
    .replace('import { sampleTables } from "./sampleTables";\n', "")
    .replace(/ {2}\/\/ Sample domain[^\n]*\n {2}\.\.\.sampleTables,\n/, "");
  writeFileSync(at(`${backend}schema.ts`), schema);
  for (const file of ["sampleTables.ts", "projects.ts", "tasks.ts", "files.ts", "projectAccess.ts",
    "projects.test.ts", "tasks.test.ts", "files.test.ts", "authorization-contract.test.ts"]) {
    rmSync(at(`${backend}${file}`), { force: true });
  }
  for (const file of ["apps/web/src/components/projects", "apps/web/src/lib/projects.ts", "apps/web/qa/tests/projects.test.ts"]) {
    rmSync(at(file), { recursive: true, force: true });
  }
  for (const [template, destination] of [
    ["app-sidebar.tsx", "apps/web/src/components/app-sidebar.tsx"],
    ["dashboard-client.tsx", `${dashboard}dashboard-client.tsx`],
    ["auth-security.test.ts", `${backend}auth-security.test.ts`],
    ["input-validation.test.ts", `${backend}input-validation.test.ts`],
    ["localized-controls.test.tsx", "apps/web/qa/tests/localized-controls.test.tsx"],
  ]) {
    writeFileSync(at(destination), readFileSync(at(`platform/templates/adopt/${template}.txt`), "utf8"));
  }
  for (const file of ["apps/web/src/components/settings/account-client.tsx", `${dashboard}settings/sessions/sessions-client.tsx`]) {
    let content = readFileSync(at(file), "utf8")
      .replaceAll("@/components/projects/app-sidebar", "@/components/app-sidebar")
      .replace(/\s*selectedProjectId=\{null\}\n/, "\n")
      .replaceAll("onSelectProject=", "onNavigateHome=")
      .replaceAll('td("projects")', 'tc("backToHome")');
    if (file.endsWith("sessions-client.tsx")) content = content.replace('  const td = useTranslations("dashboard");\n', "");
    writeFileSync(at(file), content);
  }
  for (const file of readdirSync(at("packages/messages")).filter((name) => /^[a-z]{2}\.json$/.test(name))) {
    const messages = readJson<Record<string, unknown>>(at(`packages/messages/${file}`));
    for (const key of ["projects", "tasks", "uploads"]) delete messages[key];
    writeJson(at(`packages/messages/${file}`), messages);
  }
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
  NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://placeholder.convex.site",
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud",
};

/** Run every adoption step on `root`. Returns the zone check's error count. */
export function adopt(root: string, options: AdoptOptions, log: (line: string) => void = (line) => process.stdout.write(`${line}\n`), services: { release?: typeof adoptionRelease; command?: Command } = {}): number {
  const at = (file: string): string => path.join(root, file);
  if (existsSync(at(BASE_FILE))) throw new Error(`${BASE_FILE} exists: this repository is already adopted`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error(`--repo must be owner/name (got "${options.repo}")`);
  if (git(root, ["status", "--porcelain"]) !== "") throw new Error("Adoption needs a clean checkout; commit or preserve your work first");
  const { commit, version } = (services.release ?? adoptionRelease)(root, options.fromRelease);
  log(`Pre-adoption checklist for https://github.com/${options.repo}/settings/installations and /settings/hooks:`);
  log("  - Review installed GitHub Apps, webhooks and Git-connected hosts (Vercel, Cloudflare, Netlify, etc.).");
  log("  - Repoint or pause builds tied to the old repository root before pushing the new layout.");
  log("  - These dashboard checks are manual: GitHub cannot enumerate every external hosting integration.");

  log("1. app.config.ts");
  writeFileSync(at("app.config.ts"), setAppConfig(readFileSync(at("app.config.ts"), "utf8"), options));

  log("2. Root files from platform/templates");
  for (const file of TEMPLATES) {
    const text = readFileSync(at(`platform/templates/${file}`), "utf8").replaceAll("<Product name>", () => options.name);
    writeFileSync(at(file), text);
    log(`  - ${file}`);
  }
  writeFileSync(at("renovate.json"), rewriteRenovate(readFileSync(at("renovate.json"), "utf8"), options.repo));
  log(`  - renovate.json extends local>${options.repo}//platform/config/renovate-preset`);

  mkdirSync(at(".github/workflows"), { recursive: true });
  writeFileSync(at(".github/workflows/update-platform.yml"), readFileSync(at("platform/templates/update-platform.yml"), "utf8"));
  log("  - update-platform.yml: weekday release checks (configure the updater App for automatic CI)");

  log("3. Reference apps");
  const remove = options.remove ?? [];
  if (remove.length === 0) log("  - kept all");
  removeApps(root, remove, log);
  if (options.removeSample) {
    removeSample(root);
    log("  - removed sample tables, functions and UI; kept account settings, auth and their tests");
    log("  - bun run dev regenerates the Convex API for the remaining functions");
  }
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
      git(root, ["remote", "add", "--no-tags", "-t", "main", "upstream", STARTER_URL]);
      log(`  - added upstream remote ${STARTER_URL}`);
    }
  }
  try {
    (services.command ?? commandAt(root))("gh", ["repo", "set-default", options.repo]);
    log(`  - gh default repository: ${options.repo}`);
  } catch {
    log(`  - Run gh repo set-default ${options.repo} once its remote exists. Until then use gh ... --repo ${options.repo}.`);
  }

  log("6. Platform updates");
  log("  - Weekday release checks are installed. Configure the updater GitHub App for automatic PR CI; see platform/docs/update-delivery.md.");

  log("7. Checks");
  const zone = checkZone(root);
  for (const error of zone.errors) log(`  error: ${error}`);
  log(zone.errors.length === 0 ? "  - zone check passed" : `  - zone check: ${zone.errors.length} problem(s)`);
  if (options.build !== false && zone.errors.length === 0) run(root, "bun", ["run", "build"], BUILD_PLACEHOLDERS);

  log("");
  log("Yours (edit freely): apps/, packages/backend/convex/ outside platform/, the root files.");
  log(`Seams (yours, keep the platform's hooks): app.config.ts, ${SEAM_HOOKS.map((seam) => seam.file).join(", ")}, turbo.json, package.json.`);
  log("The platform's (never edit; replaced on upgrade): platform/, packages/backend/convex/platform/, .github/workflows/platform-*.yml, .claude/skills/platform-*, .agents/skills/platform-*.");
  log("Deployment: run bun run deploy:setup --check early for accounts, DNS and setup requirements. A new unconfigured app skips automatic deployment; merging to main starts staging deployment once setup is complete.");
  log("Next: fill in the <placeholders> in README.md and AGENTS.md, review the diff, and commit.");
  log(`Then smoke-test the baseline: bun run platform:upgrade --to v${version} --dry-run (expect unchanged).`);
  return zone.errors.length;
}

type Parsed = Partial<AdoptOptions> & { yes: boolean; prE2e?: Mode };

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
      case "--from-release": parsed.fromRelease = value(); break;
      case "--port": {
        const [app, port] = value().split("=");
        if (!app || !/^\d+$/.test(port ?? "")) throw new Error("--port takes <app>=<port>");
        parsed.ports = { ...parsed.ports, [app]: Number(port) };
        break;
      }
      case "--remove": parsed.remove = parseRemove(value()); break;
      case "--remove-sample": parsed.removeSample = true; break;
      case "--no-upstream": parsed.upstream = false; break;
      case "--skip-install": parsed.install = false; break;
      case "--skip-build": parsed.build = false; break;
      case "--yes": parsed.yes = true; break;
      case "--pr-e2e": {
        const mode = value();
        if (!isMode(mode)) throw new Error(`--pr-e2e takes always, on-demand or off (got "${mode}")`);
        parsed.prE2e = mode;
        break;
      }
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

const gh: Exec = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});

/** After adoption: apply the chosen PR E2E mode, or remind a private repository that it has one to choose. */
export async function settlePrE2e(repo: string, mode: Mode | undefined, exec: Exec, log: (line: string) => void): Promise<void> {
  log("CI on pull requests");
  const status = await prE2eStatus(repo, exec).catch(() => undefined);
  if (!status) {
    log(`  - Could not read ${repo}'s Actions variables (does it exist yet?). On a private repository, choose when E2E runs on pull requests: ${manualCommand(repo)}`);
    return;
  }
  if (mode) {
    log(`  - Set ${(await applyPrE2e(repo, mode, exec)).join(", ")} (shared by everyone's CI runs in ${repo})`);
    return;
  }
  if (needsChoice(status)) log(`  - Private repository: E2E runs on every push to a ready PR. To spend fewer Actions minutes see platform/docs/private-repo-ci.md, then ${manualCommand(repo)}`);
  else log(status.private ? `  - PLATFORM_CI_PR_E2E=${status.mode}` : "  - Public repository: Actions minutes are free; E2E runs on every ready PR");
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
    parsed.removeSample ??= (await ask("Remove the projects/tasks/uploads sample? (yes/no)", "no")) === "yes";
    const status = parsed.repo && !parsed.prE2e ? await prE2eStatus(parsed.repo, gh).catch(() => undefined) : undefined;
    if (parsed.repo && status && needsChoice(status)) {
      for (const line of describeModes(parsed.repo)) process.stdout.write(`${line}\n`);
      const mode = await ask("E2E on pull requests (always/on-demand/off)", "always") ?? "always";
      if (!isMode(mode)) throw new Error(`"${mode}" is not one of always, on-demand, off`);
      parsed.prE2e = mode;
    }
    rl.close();
  }
  parsed.repo ??= defaultRepo;
  if (!parsed.name) throw new Error("--name is required");
  if (!parsed.repo) throw new Error(`--repo is required (origin is ${origin ?? "not set"}; name your own repository)`);
  const code = adopt(root, { ...parsed, name: parsed.name, repo: parsed.repo });
  await settlePrE2e(parsed.repo, parsed.prE2e, gh, (line) => process.stdout.write(`${line}\n`));
  return code === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: unknown) => {
    process.stderr.write(`adopt: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
