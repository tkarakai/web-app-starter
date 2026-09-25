/** Prepare reviewable release metadata. Publication belongs to release-starter.yml. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPO_URL = "https://github.com/tkarakai/web-app-starter";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function compare(a: string, b: string): number {
  const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function release(argv: string[]): void {
  const [version, ...flags] = argv;
  requireCondition(version && VERSION.test(version), "version must be MAJOR.MINOR.PATCH (without a v prefix or leading zeros)");
  requireCondition(flags.every((flag) => ["--dry-run", "--check", "--notes", "--require-main"].includes(flag)), "unknown flag; tagging overrides are no longer supported");
  requireCondition(flags.filter((flag) => ["--dry-run", "--check", "--notes"].includes(flag)).length <= 1, "choose one of --dry-run, --check or --notes");
  const check = flags.includes("--check") || flags.includes("--notes");
  requireCondition(!flags.includes("--require-main") || check, "--require-main is only for checking prepared releases");
  requireCondition(git("status", "--porcelain") === "", "working tree is dirty; commit your changes first");
  if (flags.includes("--require-main")) {
    // The publishing workflow fetches origin/main immediately before this check.
    requireCondition(git("rev-parse", "HEAD") === git("rev-parse", "refs/remotes/origin/main"), "release commit must be the fetched origin/main tip");
  }

  const tag = `v${version}`;
  const tags = git("tag", "-l", "v*").split("\n").filter((value) => VERSION.test(value.slice(1)));
  const latest = tags.map((value) => value.slice(1)).sort(compare).at(-1);
  if (check) {
    requireCondition(!latest || compare(version, latest) >= 0, `version is older than published/local tag v${latest}`);
    if (tags.includes(tag)) {
      requireCondition(git("rev-parse", `${tag}^{commit}`) === git("rev-parse", "HEAD"), `${tag} already names another commit; never move a release tag`);
    }
  } else {
    requireCondition(!latest || compare(version, latest) > 0, `version must follow v${latest}`);
  }

  const packageSource = readFileSync("package.json", "utf8");
  const pkg = JSON.parse(packageSource) as { version?: string };
  requireCondition(typeof pkg.version === "string", "package.json has no version");
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const sections = [...changelog.matchAll(/^## \[([^\]]+)\]([^\n]*)\n([\s\S]*?)(?=^## \[|$(?![\s\S]))/gm)];
  requireCondition(sections[0]?.[1] === "Unreleased", "CHANGELOG.md must start with ## [Unreleased]");
  const body = (value: string): string => value.replace(/^\[[^\]]+\]:.*$/gm, "").trim();
  const unreleased = body(sections[0][3]);
  let notes: string;
  if (check) {
    requireCondition(pkg.version === version, "package.json version does not match the requested release");
    requireCondition(unreleased === "", "Unreleased is not empty; prepare and review those changes first");
    requireCondition(sections[1]?.[1] === version && /^ - \d{4}-\d{2}-\d{2}$/.test(sections[1][2]), "newest changelog release must match the version and have a date");
    requireCondition(sections.filter((section) => section[1] === version).length === 1, "duplicate release section");
    notes = body(sections[1][3]);
  } else {
    requireCondition(unreleased.length > 0, "Unreleased is empty; nothing to prepare");
    requireCondition(!sections.some((section) => section[1] === version), "release already exists in the changelog");
    requireCondition(compare(version, pkg.version) >= 0, "cannot lower package.json version");
    notes = unreleased;
  }
  requireCondition(notes.length > 0, "release notes are empty");
  const previous = tags.map((value) => value.slice(1)).filter((value) => compare(value, version) < 0).sort(compare).at(-1);
  if (previous && previous.split(".")[0] !== version.split(".")[0]) {
    requireCondition(/^### Action required\s*$/m.test(notes), "major releases require an Action required section");
  }
  if (flags.includes("--notes")) {
    process.stdout.write(`${notes}\n`);
    return;
  }
  if (check || flags.includes("--dry-run")) {
    console.log(`release: ${tag} ${check ? "metadata verified" : "preparation checks passed (no changes)"}`);
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const nextPackage = { ...JSON.parse(packageSource), version };
  let nextChangelog = changelog.replace(/^## \[Unreleased\][ \t]*$/m, `## [Unreleased]\n\n## [${version}] - ${date}`);
  nextChangelog = nextChangelog.replace(/^\[Unreleased\]:.*\n?/gm, "").trimEnd();
  nextChangelog += `\n\n[Unreleased]: ${REPO_URL}/compare/${tag}...HEAD\n[${version}]: ${REPO_URL}/${previous ? `compare/v${previous}...${tag}` : `releases/tag/${tag}`}\n`;
  writeFileSync("package.json", `${JSON.stringify(nextPackage, null, 2)}\n`);
  writeFileSync("CHANGELOG.md", nextChangelog);
  console.log(`release: prepared ${tag}; review and commit package.json and CHANGELOG.md in a PR. No commit or tag created.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { release(process.argv.slice(2)); }
  catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
