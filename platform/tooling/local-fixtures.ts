#!/usr/bin/env node
/** Provision fixture credentials only for an explicitly owned local backend. */
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

type Env = Record<string, string | undefined>;
const FIXTURE_KEYS = ["DEV_SEED_ENABLED", "DEV_FIXTURE_RUNTIME", "DEV_FIXTURE_SECRET"];
const TARGET_KEYS = ["CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"];
const readEnv = (file: string): Env => fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};

export function assertAnonymousLaunch(env: Env, fileEnv: Env): void {
  if (TARGET_KEYS.some(key => env[key] || fileEnv[key])) throw new Error("Local startup refuses deployment keys or self-hosted overrides. Use a separate terminal and local checkout.");
  for (const source of [env, fileEnv]) {
    if (source.CONVEX_DEPLOYMENT && !/^anonymous:[a-zA-Z0-9_-]+$/.test(source.CONVEX_DEPLOYMENT)) throw new Error("Local startup requires an anonymous deployment; refusing a cloud or ambiguous target.");
  }
}

export function assertHostedEnvironment(names: string): void {
  const variables = names.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (variables.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error("Could not parse deployment environment names; refusing deployment.");
  if (variables.some(name => FIXTURE_KEYS.includes(name))) throw new Error("Remove DEV_SEED_ENABLED, DEV_FIXTURE_RUNTIME and DEV_FIXTURE_SECRET from this hosted deployment before deploying. Fixture settings are local-only.");
}

export function anonymousTarget(fileEnv: Env, config: { ports?: { cloud?: number; site?: number }; adminKey?: string; deploymentName?: string }): Env {
  const name = fileEnv.CONVEX_DEPLOYMENT?.replace(/^anonymous:/, "");
  assertAnonymousLaunch({}, fileEnv);
  if (!name || config.deploymentName !== name || !config.adminKey) throw new Error("Anonymous backend identity is missing or does not match local state.");
  for (const [key, port] of [["CONVEX_URL", config.ports?.cloud], ["CONVEX_SITE_URL", config.ports?.site]] as const) {
    const url = new URL(fileEnv[key] ?? "");
    if (!Number.isInteger(port) || !port || url.origin !== `http://127.0.0.1:${port}` || url.href !== url.origin + "/") throw new Error("Backend URLs must match the anonymous backend's loopback ports.");
  }
  return { CONVEX_SELF_HOSTED_URL: fileEnv.CONVEX_URL, CONVEX_SELF_HOSTED_ADMIN_KEY: config.adminKey };
}

export type ConvexCommand = (args: string[], input?: string) => string;
export function provisionFixtures(command: ConvexCommand, runtime: "anonymous" | "local-aws", file: string, siteUrl: string): void {
  const previous = readEnv(file);
  const secret = previous.CONVEX_SITE_URL === siteUrl && /^[a-f0-9]{64}$/.test(previous.DEV_FIXTURE_SECRET ?? "") ? previous.DEV_FIXTURE_SECRET! : randomBytes(32).toString("hex");
  // Supply secrets on stdin, never in argv or logs. Set the flags atomically.
  command(["env", "set", "--force"], `DEV_FIXTURE_RUNTIME=${runtime}\nDEV_FIXTURE_SECRET=${secret}\nDEV_SEED_ENABLED=true\n`);
  fs.writeFileSync(file, `CONVEX_SITE_URL=${siteUrl}\nDEV_FIXTURE_SECRET=${secret}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function withTarget(root: string, target: Env, operation: (command: ConvexCommand) => void): void {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "convex-fixtures-"));
  try {
    const envFile = path.join(directory, ".env");
    fs.writeFileSync(envFile, Object.entries(target).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
    const environment = { ...process.env };
    for (const key of [...TARGET_KEYS, "CONVEX_DEPLOYMENT", "CONVEX_AGENT_MODE"]) delete environment[key];
    const command: ConvexCommand = (args, input) => {
      const result = spawnSync(path.join(root, "packages/backend/node_modules/.bin/convex"), [...args, "--env-file", envFile], { cwd: path.join(root, "packages/backend"), env: environment, input, timeout: 60_000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error("Convex fixture configuration check failed; verify target access and connectivity. No deployment changes should proceed.");
      return result.stdout;
    };
    operation(command);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const mode = process.argv[2];
    const fileEnv = readEnv(path.join(root, "packages/backend/.env.local"));
    if (mode === "check-launch") {
      assertAnonymousLaunch(process.env, { ...readEnv(path.join(root, ".env.local")), ...fileEnv });
    } else if (mode === "anonymous") {
      assertAnonymousLaunch(process.env, fileEnv);
      const name = fileEnv.CONVEX_DEPLOYMENT?.replace(/^anonymous:/, "");
      if (!name) throw new Error("No anonymous backend is configured.");
      const config = JSON.parse(fs.readFileSync(path.join(homedir(), ".convex/anonymous-convex-backend-state", name, "config.json"), "utf8"));
      const target = anonymousTarget(fileEnv, config);
      withTarget(root, target, command => provisionFixtures(command, "anonymous", path.join(root, ".env.e2e.local"), fileEnv.CONVEX_SITE_URL!));
    } else if (mode === "local-aws") {
      // The local compose target publishes precisely these loopback-bound ports.
      if (process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_SELF_HOSTED_URL !== "http://convex.localhost.floci.io:3310") throw new Error("Local AWS fixtures require the dedicated local compose backend.");
      const state = path.join(root, "infra/aws/local/.state");
      const key = fs.readFileSync(path.join(state, "convex-admin-key"), "utf8").trim();
      if (!key || key !== process.env.CONVEX_SELF_HOSTED_ADMIN_KEY) throw new Error("Local AWS admin key does not match the local target.");
      // Use the loopback socket, not public DNS, when provisioning credentials.
      withTarget(root, { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3310", CONVEX_SELF_HOSTED_ADMIN_KEY: key }, command => provisionFixtures(command, "local-aws", path.join(state, "fixture.env"), "http://convex.localhost.floci.io:3311"));
    } else if (mode === "check-hosted") {
      if (!process.env.CONVEX_DEPLOY_KEY) throw new Error("Hosted fixture preflight requires the deployment key used for deployment.");
      withTarget(root, { CONVEX_DEPLOY_KEY: process.env.CONVEX_DEPLOY_KEY }, command => assertHostedEnvironment(command(["env", "list", "--names-only"])));
      console.log("Hosted fixture preflight passed.");
    } else throw new Error("Usage: local-fixtures.ts check-launch|anonymous|local-aws|check-hosted");
  } catch (error) { console.error(error instanceof Error ? error.message : "Local fixture configuration failed."); process.exitCode = 1; }
}
