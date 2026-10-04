import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

type Env = Record<string, string | undefined>;
export type ConvexCommand = (args: string[], input?: string) => string;
const FIXTURE_KEYS = ["DEV_SEED_ENABLED", "DEV_FIXTURE_RUNTIME", "DEV_FIXTURE_SECRET"];
export const DEPLOY_KEYS = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"];
export const TARGET_KEYS = [...DEPLOY_KEYS, "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"];

export function assertHostedEnvironment(names: string): void {
  const variables = names.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (variables.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error("Could not parse deployment environment names; refusing deployment.");
  if (variables.some(name => FIXTURE_KEYS.includes(name))) throw new Error("Remove DEV_SEED_ENABLED, DEV_FIXTURE_RUNTIME and DEV_FIXTURE_SECRET from this hosted deployment before deploying. Fixture settings are local-only.");
}

export function withTarget(root: string, target: Env, operation: (command: ConvexCommand) => void, cliVersion?: string): void {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "convex-fixtures-"));
  try {
    const envFile = path.join(directory, ".env");
    if (cliVersion) fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ private: true, dependencies: { convex: cliVersion } }));
    fs.writeFileSync(envFile, Object.entries(target).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
    const environment = { ...process.env };
    for (const key of [...TARGET_KEYS, "CONVEX_DEPLOYMENT", "CONVEX_AGENT_MODE"]) delete environment[key];
    const command: ConvexCommand = (args, input) => {
      const result = spawnSync(cliVersion ? "bunx" : path.join(root, "packages/backend/node_modules/.bin/convex"), [...(cliVersion ? [`convex@${cliVersion}`] : []), ...args, "--env-file", envFile], { cwd: cliVersion ? directory : path.join(root, "packages/backend"), env: environment, input, timeout: 60_000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error("Convex fixture configuration check failed; verify target access and connectivity. No deployment changes should proceed.");
      return result.stdout;
    };
    operation(command);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

export function checkHostedFixtures(root: string): void {
  if (!process.env.CONVEX_DEPLOY_KEY) throw new Error("Hosted fixture preflight requires the deployment key used for deployment.");
  withTarget(root, { CONVEX_DEPLOY_KEY: process.env.CONVEX_DEPLOY_KEY }, command => assertHostedEnvironment(command(["env", "list", "--names-only"])), "1.46.0");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    checkHostedFixtures(process.cwd());
    console.log("Hosted fixture preflight passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Hosted fixture preflight failed.");
    process.exitCode = 1;
  }
}
