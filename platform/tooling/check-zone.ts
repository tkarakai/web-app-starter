// Zone check: the platform zone is only edited through recorded patches, and the seams keep
// the platform's hooks.
// Usage: ./platform/tooling/node-ts.sh platform/tooling/check-zone.ts [ROOT]
//
// The platform zone is every path with a directory named `platform`, or a file or directory
// named `platform-*` (platform/**, packages/backend/convex/platform/**,
// .github/workflows/platform-*.yml, .claude/skills/platform-*, .agents/skills/platform-*). An
// adopted app records the platform release it is on in `.platform-base.json`:
//
//   { "version": "2.0.0", "commit": "<release commit>", "patches": [{ "path": "...", "reason": "..." }] }
//
// Every zone file that differs from that commit must be a recorded patch, and a recorded patch
// in a file that takes comments must carry a `PLATFORM-PATCH: <reason>` marker. Without the file
// (the product repo, where the platform is developed) zone edits are platform work, and the
// check instead confirms that no app code carries a patch marker: reference apps never do.
// In both cases the seams must still contain the platform's hooks.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isZonePath } from "./platform-upgrade/ownership.ts";
import { MANIFEST, parseManifest } from "./platform-upgrade/metadata.ts";
export { isZonePath } from "./platform-upgrade/ownership.ts";

export const BASE_FILE = ".platform-base.json";
export const MARKER = "PLATFORM-PATCH:";

export type Patch = { path: string; reason: string };
export type PlatformBase = { version: string; commit: string; patches: Patch[]; earlyCommits?: string[] };

// Files whose format has no comments: a patch there is recorded in .platform-base.json only.
const NO_COMMENTS = new Set([".json", ".lock", ".png", ".ico", ".svg", ".jpg", ".webp", ".woff2"]);

// Seams and the platform hook each must keep.
export const SEAM_HOOKS: readonly { file: string; hook: string; why: string }[] = [
  { file: "packages/backend/convex/schema.ts", hook: "...platformTables", why: "the platform's tables" },
  { file: "packages/backend/convex/http.ts", hook: "registerPlatformRoutes(http)", why: "the platform's HTTP routes" },
  { file: "packages/backend/convex/convex.config.ts", hook: "./platform/betterAuth/convex.config", why: "the Better Auth component" },
  { file: "packages/backend/convex/convex.config.ts", hook: "app.use(platform)", why: "the platform data component" },
  { file: "tsconfig.json", hook: "platform/config/tsconfig.base.json", why: "the TypeScript base" },
  { file: "eslint.config.mjs", hook: "platform/config/eslint.base.mjs", why: "the ESLint base" },
  { file: "renovate.json", hook: "platform/config/renovate-preset", why: "the Renovate preset" },
];


export function parseBase(text: string): PlatformBase | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return `${BASE_FILE} is not valid JSON: ${(error as Error).message}`;
  }
  const base = raw as Partial<PlatformBase>;
  if (typeof base !== "object" || base === null) return `${BASE_FILE} must be an object`;
  if (typeof base.version !== "string" || base.version === "") return `${BASE_FILE}: "version" must be a non-empty string`;
  if (typeof base.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(base.commit)) {
    return `${BASE_FILE}: "commit" must be the release commit SHA`;
  }
  const patches = base.patches ?? [];
  if (!Array.isArray(patches)) return `${BASE_FILE}: "patches" must be an array`;
  for (const [index, patch] of patches.entries()) {
    const p = patch as Partial<Patch>;
    if (typeof p?.path !== "string" || p.path === "" || typeof p.reason !== "string" || p.reason.trim() === "") {
      return `${BASE_FILE}: patches[${index}] needs a "path" and a non-empty "reason"`;
    }
  }
  if (base.earlyCommits !== undefined && (!Array.isArray(base.earlyCommits) || !base.earlyCommits.every(commit => typeof commit === "string" && /^[0-9a-f]{7,40}$/.test(commit)))) return `${BASE_FILE}: earlyCommits must contain commit IDs`;
  return { version: base.version, commit: base.commit, patches: patches as Patch[], ...(base.earlyCommits ? { earlyCommits: base.earlyCommits } : {}) };
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

export function checkSeams(root: string): string[] {
  const errors: string[] = [];
  let hooks = [...SEAM_HOOKS];
  const manifestPath = path.join(root, MANIFEST);
  if (existsSync(manifestPath)) {
    try {
      const seams = parseManifest(readFileSync(manifestPath, "utf8")).seams
        .filter(seam => !seam.optionalApp || existsSync(path.join(root, seam.optionalApp)));
      for (const seam of seams) if (!existsSync(path.join(root, seam.path))) errors.push(`${seam.path}: required seam is missing (${seam.id})`);
      hooks = seams.flatMap(seam => seam.hooks.map(hook => ({ file: seam.path, hook, why: seam.id })));
    } catch (error) { return ["Invalid release seam definitions: " + (error as Error).message]; }
  }
  for (const { file, hook, why } of hooks) {
    const full = path.join(root, file);
    if (!existsSync(full)) errors.push(`${file}: seam is missing (it must contain "${hook}" for ${why})`);
    else if (!readFileSync(full, "utf8").includes(hook)) errors.push(`${file}: keep "${hook}" (${why})`);
  }
  return errors;
}

export type ZoneResult = { errors: string[]; warnings: string[]; patches: Patch[]; mode: "adopted" | "product" };

export function checkZone(root: string, options: { baseFile?: string } = {}): ZoneResult {
  const errors = checkSeams(root);
  const warnings: string[] = [];
  const baseFile = options.baseFile ? path.resolve(options.baseFile) : path.join(root, BASE_FILE);

  if (options.baseFile && !existsSync(baseFile)) return { errors: [...errors, "Candidate baseline is missing: " + baseFile], warnings, patches: [], mode: "adopted" };
  if (!existsSync(baseFile)) {
    // Product repo: no app code may carry a patch marker.
    let marked: string[];
    try {
      marked = git(root, ["grep", "-l", "-F", MARKER, "--", ".", ":!platform/"]).split("\n").filter(Boolean);
    } catch {
      marked = []; // git grep exits 1 when nothing matches
    }
    for (const file of marked) {
      errors.push(`${file}: carries a ${MARKER} marker, but this repository has no ${BASE_FILE}. Reference apps never carry patches: make the change as platform work`);
    }
    return { errors, warnings, patches: [], mode: "product" };
  }

  const base = parseBase(readFileSync(baseFile, "utf8"));
  if (typeof base === "string") return { errors: [...errors, base], warnings, patches: [], mode: "adopted" };
  try {
    git(root, ["cat-file", "-e", `${base.commit}^{commit}`]);
  } catch {
    errors.push(`${BASE_FILE}: commit ${base.commit} (platform ${base.version}) is not in this clone. Fetch it (git fetch upstream --tags), or check out with full history in CI`);
    return { errors, warnings, patches: base.patches, mode: "adopted" };
  }

  const changed = [...new Set([
    ...git(root, ["diff", "--name-only", "--no-renames", "-z", base.commit, "--"]).split("\0"),
    ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
  ].filter(file => file !== "" && isZonePath(file)))];
  const recorded = new Map(base.patches.map((patch) => [patch.path, patch]));
  for (const file of changed) {
    if (!recorded.has(file)) {
      errors.push(`${file}: platform-zone edit is not a recorded patch. Undo it (git checkout ${base.commit.slice(0, 12)} -- ${file}) or record it with the platform-patch skill`);
      continue;
    }
    const full = path.join(root, file);
    if (existsSync(full) && !NO_COMMENTS.has(path.extname(file)) && !readFileSync(full, "utf8").includes(MARKER)) {
      errors.push(`${file}: recorded patch has no "${MARKER} <reason>" comment at the edit`);
    }
  }
  const changedSet = new Set(changed);
  for (const patch of base.patches) {
    if (!isZonePath(patch.path)) errors.push(`${BASE_FILE}: ${patch.path} is not in the platform zone; app files need no patch record`);
    else if (!changedSet.has(patch.path)) warnings.push(`${patch.path}: recorded patch no longer differs from platform ${base.version}; remove the record`);
  }
  return { errors, warnings, patches: base.patches, mode: "adopted" };
}

export function main(argv: readonly string[], out: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): number {
  let root = path.resolve("."); let baseFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-file") { baseFile = argv[++i]; if (!baseFile) { out("error: --base-file needs a path"); return 1; } }
    else if (argv[i].startsWith("--")) { out("error: unknown option " + argv[i]); return 1; }
    else root = path.resolve(argv[i]);
  }
  const { errors, warnings, patches, mode } = checkZone(root, { baseFile });
  for (const error of errors) out(`error: ${error}`);
  for (const warning of warnings) out(`warning: ${warning}`);
  if (mode === "product") out(`No ${BASE_FILE}: product repository, platform edits are platform work.`);
  else if (patches.length === 0) out("Recorded platform patches: none.");
  else {
    out(`Recorded platform patches (${patches.length}):`);
    for (const patch of patches) out(`  ${patch.path}: ${patch.reason}`);
  }
  out(errors.length === 0 ? "Zone check passed." : `check-zone: ${errors.length} problem(s)`);
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
