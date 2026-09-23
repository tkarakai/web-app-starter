import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { object } from "./types.js";
import type { Config, Environment } from "./types.js";

// This module executes from scripts/ops/dist after the strict TypeScript build.
export const ROOT = resolve(__dirname, "../../..");
export const ENVIRONMENTS: Environment[] = ["staging", "production"];
export const WORKFLOWS = [
  "cd-staging.yml",
  "cd-production.yml",
  "cd-rollback.yml",
];

/** Safe validation messages contain no supplied values or credentials. */
export class ConfigError extends Error {}

export function loadConfig(
  path?: string,
  repoOption?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  let data: Record<string, unknown> = {};
  if (path) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      )
        throw new Error();
      data = object(parsed);
    } catch {
      throw new ConfigError("Cannot read configuration JSON object");
    }
  }
  if (
    Object.keys(data).some((k) => !["repo", "projects", "team_id"].includes(k))
  ) {
    throw new ConfigError(
      "Config supports only repo, projects and team_id (no credentials)",
    );
  }
  let repo: unknown = repoOption || env.GH_REPO || data.repo;
  if (!repo) {
    let remote = "";
    try {
      remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      /* explicit repo required below */
    }
    repo =
      /^(?:https:\/\/github\.com\/|git@github\.com:)([^\s]+?)(?:\.git)?$/.exec(
        remote,
      )?.[1];
  }
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new ConfigError(
      "Set --repo OWNER/REPO, GH_REPO or config.repo (github.com)",
    );
  const configured = data.projects ?? {};
  if (
    configured === null ||
    typeof configured !== "object" ||
    Array.isArray(configured)
  )
    throw new ConfigError(
      "projects must map app names to staging/production project IDs",
    );
  const mappings = object(configured);
  const localApps = readdirSync(resolve(ROOT, "apps")).filter((app) =>
    existsSync(resolve(ROOT, "apps", app, "package.json")),
  );
  const apps = [...new Set([...localApps, ...Object.keys(mappings)])].sort();
  const projects: Config["projects"] = {};
  const seen = new Set<string>();
  for (const app of apps) {
    if (!/^[a-z][a-z0-9-]*$/.test(app))
      throw new ConfigError("Invalid application name in configuration");
    const mapping = mappings[app] ?? {};
    if (
      mapping === null ||
      typeof mapping !== "object" ||
      Array.isArray(mapping) ||
      Object.keys(mapping).some((k) => !ENVIRONMENTS.includes(k as Environment))
    )
      throw new ConfigError(
        "Each app supports staging and production project IDs only",
      );
    projects[app] = {};
    for (const environment of ENVIRONMENTS) {
      const key = `VERCEL_PROJECT_ID_${app.toUpperCase().replaceAll("-", "_")}${environment === "staging" ? "_STAGING" : ""}`;
      const project = env[key] || object(mapping)[environment];
      if (project !== undefined) {
        if (typeof project !== "string" || !/^prj_[A-Za-z0-9]+$/.test(project))
          throw new ConfigError(
            "Use Vercel project IDs (prj_...), not names or URLs",
          );
        if (seen.has(project))
          throw new ConfigError(
            "A Vercel project may map to only one application/environment",
          );
        seen.add(project);
        projects[app][environment] = project;
      }
    }
  }
  const team = env.VERCEL_ORG_ID || data.team_id;
  if (
    team !== undefined &&
    (typeof team !== "string" || !/^[A-Za-z0-9_]+$/.test(team))
  )
    throw new ConfigError("Invalid Vercel team_id");
  return { repo, apps, projects, team_id: team as string | undefined };
}
