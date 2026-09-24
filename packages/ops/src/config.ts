import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OpsError, registerSecret, usage } from "./errors";
import type { Config } from "./types";
const exec = promisify(execFile);
export async function command(file: string, args: string[]): Promise<string> {
  try { return (await exec(file, args, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim(); }
  catch (cause) { throw new OpsError("LOCAL_COMMAND", `Could not run ${file} ${args.join(" ")}: ${cause instanceof Error ? cause.message : cause}`, "Check that the command is installed and authenticated.", 1, {}, { cause }); }
}
export async function githubToken() {
  let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    try { token = await command("gh", ["auth", "token", "--hostname", "github.com"]); }
    catch (cause) {
      const inner = cause instanceof Error ? cause.cause as { code?: string } | undefined : undefined;
      const missing = inner?.code === "ENOENT";
      throw new OpsError(missing ? "CLI_MISSING" : "AUTH", missing ? "GitHub CLI is not installed." : `Cannot use the GitHub CLI session: ${String(cause)}`,
        missing ? "Install GitHub CLI from https://cli.github.com, then run bun run ops setup." : "Run bun run ops auth login github (or gh auth login --hostname github.com), then retry. GH_TOKEN / GITHUB_TOKEN override the CLI session when set.", 1, { provider: "github" }, { cause });
    }
  }
  if (!token.trim()) throw new OpsError("AUTH", "GitHub CLI returned an empty credential.", "Run ops auth login github.");
  registerSecret(token); return token;
}
export function defaultConfig(repository: string): Config {
  return { repository, workflowRef: "main", apps: {
    web: { projects: {} }, admin: { projects: {} }, landing: { projects: {} },
  } };
}
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== "object") usage("Configuration must be a JSON object.");
  function rejectCredentials(object: unknown): void {
    if (!object || typeof object !== "object") return;
    for (const [key, entry] of Object.entries(object)) {
      if (/^(?:(?:github|gh|vercel)[_-]?)?(?:token|access[_-]?token|refresh[_-]?token|password|secret)$/i.test(key)) {
        if (typeof entry === "string") registerSecret(entry);
        throw new OpsError("CONFIG_CREDENTIAL", `Credential field ${key} is not allowed in ops configuration.`, "Remove the credential from the file. Use gh auth login / vercel login, or environment variables supplied by a secret manager.", 2);
      }
      rejectCredentials(entry);
    }
  }
  rejectCredentials(value);
  const c = value as Config;
  if (typeof c.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(c.repository)) usage("repository must be owner/repository.");
  if (typeof c.workflowRef !== "string" || !c.workflowRef) usage("workflowRef must name the branch containing the deployment workflows.");
  if (c.teamId !== undefined && typeof c.teamId !== "string") usage("teamId must be a string.");
  if (!c.apps || typeof c.apps !== "object" || !Object.keys(c.apps).length) usage("apps must contain at least one app.");
  const mapped = new Set<string>();
  for (const [name, app] of Object.entries(c.apps)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || !app || !app.projects || typeof app.projects !== "object") usage(`Invalid app configuration: ${name}.`);
    for (const [env, project] of Object.entries(app.projects)) {
      if (!["staging", "production"].includes(env)) usage(`Invalid environment for ${name}/${env}.`);
      if (project === null) continue;
      if (project && mapped.has(project.id)) usage("A Vercel project may only be mapped to one app/environment pair.");
      if (project) mapped.add(project.id);
      if (!project || typeof project.id !== "string" || !project.id) usage(`Invalid project for ${name}/${env}.`);
      if (project.domain != null && (typeof project.domain !== "string" || !/^[a-zA-Z0-9.-]+$/.test(project.domain))) usage(`domain for ${name}/${env} must be a hostname without https:// or a path.`);
    }
  }
  return c;
}
export async function loadConfig(path?: string, repo?: string): Promise<Config> {
  let c: Config;
  try { c = validateConfig(JSON.parse(await readFile(path ?? "ops.config.json", "utf8"))); }
  catch (cause) {
    if ((cause as { code?: string }).code !== "ENOENT" || path) {
      const hint = `Run bun run ops setup --config ${JSON.stringify(path ?? "ops.config.json")} to repair the configuration, keeping valid settings as defaults.`;
      if (cause instanceof OpsError) {
        if (cause.code === "CONFIG_CREDENTIAL") throw cause;
        throw new OpsError("CONFIG_INVALID", cause.message, hint, 2, {}, { cause });
      }
      throw new OpsError("CONFIG", `Cannot read configuration ${path ?? "ops.config.json"}: ${cause instanceof SyntaxError ? "invalid JSON" : String(cause)}`, hint, 2, {}, { cause });
    }
    c = defaultConfig(repo ?? await command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]));
  }
  if (repo) c.repository = repo;
  return validateConfig(c);
}
