#!/usr/bin/env node
/** Read-only release discovery. Majors always need a person, including policy=major. */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { demand, digest, parseAdvisories, type Advisory } from "./platform-upgrade/metadata.ts";
import { compare, satisfies, version } from "./platform-upgrade/semver.ts";
import { readRegular } from "./platform-upgrade/io.ts";
import { releaseAssetURL, validateSource } from "./platform-upgrade/git.ts";

export type Policy = "patch" | "minor" | "major";
export type Severity = "none" | Advisory["severity"];
export type PublishedRelease = { version: string; tag: string; url: string; publishedAt: string };
export type UpdateCheck = {
  schemaVersion: 1; source: string; policy: Policy; installed?: string;
  outcome: "not-adopted" | "no-releases" | "current" | "update-available" | "major-available";
  latest?: PublishedRelease; target?: PublishedRelease; major?: PublishedRelease;
  advisories: Advisory[]; severity: Severity; advisoryDigest?: string; advisoryRelease?: PublishedRelease;
};
export type ReadURL = (url: string) => Promise<string>;
const LEVELS: Severity[] = ["none", "low", "medium", "high", "critical"];
export const DEFAULT_REPO = "tkarakai/web-app-starter";

/** Bounded reads; never attach a token to release assets or print response bodies on errors. */
export const readURL: ReadURL = async (url) => {
  const parsed = new URL(url);
  demand(parsed.protocol === "https:" && ["api.github.com", "github.com"].includes(parsed.hostname) && !parsed.username && !parsed.password, "Unexpected release host");
  const headers: Record<string, string> = { "User-Agent": "web-app-starter-update-check" };
  if (parsed.hostname === "api.github.com") {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = "Bearer " + token;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  demand(response.ok, `Release lookup failed (HTTP ${response.status}); retry or check the repository and read-token access`);
  demand(response.body, "Empty release response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; demand(size <= 5 * 1024 * 1024, "Release response exceeds 5 MiB"); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
};

export async function publishedReleases(repo: string, read: ReadURL = readURL): Promise<PublishedRelease[]> {
  validateSource({ kind: "github", repo }); const result = new Map<string, PublishedRelease>();
  for (let page = 1; page <= 100; page++) {
    const rows: unknown = JSON.parse(await read(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`));
    demand(Array.isArray(rows) && rows.length <= 100, "Malformed release listing");
    for (const row of rows) {
      demand(row && typeof row === "object" && typeof row.tag_name === "string" && typeof row.draft === "boolean" && typeof row.prerelease === "boolean", "Malformed release entry");
      if (row.draft || row.prerelease || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(row.tag_name)) continue;
      const value = row.tag_name.slice(1); version(value);
      demand(typeof row.published_at === "string" && Number.isFinite(Date.parse(row.published_at)), "Stable release has no publication timestamp");
      result.set(value, { version: value, tag: row.tag_name, publishedAt: row.published_at, url: `https://github.com/${repo}/releases/tag/${row.tag_name}` });
    }
    if (rows.length < 100) return [...result.values()].sort((a, b) => compare(a.version, b.version));
  }
  throw new Error("Release history exceeds the supported 10,000 entries; refusing a partial result");
}
export function affectedAdvisories(installed: string, text: string): { advisories: Advisory[]; severity: Severity } {
  version(installed);
  const advisories = parseAdvisories(text).advisories.filter(row => satisfies(installed, row.affected));
  const severity = advisories.reduce<Severity>((highest, row) => LEVELS.indexOf(row.severity) > LEVELS.indexOf(highest) ? row.severity : highest, "none");
  return { advisories, severity };
}
export function selectRelease(installed: string, releases: PublishedRelease[], policy: Policy, requested?: string): Pick<UpdateCheck, "outcome" | "latest" | "target" | "major"> {
  const [major, minor] = version(installed); demand(["patch", "minor", "major"].includes(policy), "Unknown update policy");
  const sorted = [...releases].sort((a, b) => compare(a.version, b.version));
  const latest = sorted.at(-1); if (!latest) { demand(!requested, "Requested release has not been published"); return { outcome: "no-releases" }; }
  const newer = sorted.filter(row => compare(row.version, installed) > 0);
  const nextMajor = newer.filter(row => version(row.version)[0] > major).at(-1);
  if (requested) {
    const wanted = requested.replace(/^v/, ""); version(wanted);
    const chosen = sorted.find(row => row.version === wanted); demand(chosen, "Requested release has not been published");
    demand(compare(wanted, installed) >= 0, "Requested release would downgrade the installed platform");
    if (version(wanted)[0] > major) return { outcome: "major-available", latest, major: chosen };
    demand(policy !== "patch" || version(wanted)[1] === minor, "Requested minor release exceeds patch policy");
    return { outcome: wanted === installed ? "current" : "update-available", latest, target: wanted === installed ? undefined : chosen, major: nextMajor };
  }
  const target = newer.filter(row => version(row.version)[0] === major && (policy !== "patch" || version(row.version)[1] === minor)).at(-1);
  return { outcome: target ? "update-available" : nextMajor ? "major-available" : "current", latest, target, major: nextMajor };
}
export async function checkUpdates(options: { root: string; repo?: string; policy?: Policy; to?: string; read?: ReadURL }): Promise<UpdateCheck> {
  const repo = options.repo ?? DEFAULT_REPO, policy = options.policy ?? "minor", read = options.read ?? readURL;
  validateSource({ kind: "github", repo }); demand(["patch", "minor", "major"].includes(policy), "Unknown update policy");
  const result: UpdateCheck = { schemaVersion: 1, source: repo, policy, outcome: "not-adopted", advisories: [], severity: "none" };
  let base: { version?: unknown; commit?: unknown };
  try { base = JSON.parse(readRegular(path.join(options.root, ".platform-base.json"), 1024 * 1024).content.toString("utf8")); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return result; throw error; }
  demand(base && typeof base.version === "string" && typeof base.commit === "string" && /^[a-f0-9]{7,40}$/.test(base.commit), "Invalid installed platform baseline");
  version(base.version); result.installed = base.version;
  const releases = await publishedReleases(repo, read); Object.assign(result, selectRelease(base.version, releases, policy, options.to));
  const advisoryRelease = [...releases].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || compare(a.version, b.version)).at(-1);
  if (advisoryRelease) {
    const text = await read(releaseAssetURL({ kind: "github", repo }, advisoryRelease.version, "advisories.json"));
    Object.assign(result, affectedAdvisories(base.version, text), { advisoryDigest: digest(text), advisoryRelease });
  }
  return result;
}
export function advisoryExitCode(result: UpdateCheck): number { return result.outcome === "no-releases" || ["high", "critical"].includes(result.severity) ? 1 : 0; }
export function advisoryMessages(result: UpdateCheck): string[] {
  const escape = (value: string) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  if (result.outcome === "no-releases") return ["::error::No published platform release supplies advisory data; verify the configured source before certifying this adopted app."];
  return result.advisories.map(row => `::${["high", "critical"].includes(row.severity) ? "error" : "warning"}::${escape(`${row.id} (${row.severity}): ${row.summary} Installed ${result.installed}; fixed in ${row.fixed}.`)}`);
}
export async function main(argv: string[]): Promise<number> {
  const options: { root: string; repo?: string; policy?: Policy; to?: string } = { root: process.cwd() }; let report: string | undefined, advisoryOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]; if (flag === "--advisories") { advisoryOnly = true; continue; }
    demand(["--root", "--repo", "--policy", "--to", "--report"].includes(flag), "Unknown argument: " + flag);
    const value = argv[++i]; demand(value && !value.startsWith("--"), flag + " needs a value");
    if (flag === "--report") report = path.resolve(value);
    else if (flag === "--root") options.root = path.resolve(value);
    else if (flag === "--repo") options.repo = value;
    else if (flag === "--policy") options.policy = value as Policy;
    else options.to = value;
  }
  const result = await checkUpdates(options), json = JSON.stringify(result, null, 2) + "\n";
  if (report) fs.writeFileSync(report, json, { flag: "wx", mode: 0o600 });
  for (const message of advisoryMessages(result)) console.error(message);
  console.log(json.trimEnd()); return advisoryOnly ? advisoryExitCode(result) : 0;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    // Network exceptions can include credential-bearing request details; only fixed diagnostics escape.
    console.error("update-check: " + (error instanceof TypeError ? "Release lookup failed; retry with network access" : error instanceof Error ? error.message : "Release lookup failed")); process.exitCode = 1;
  });
}
