#!/usr/bin/env node
/** Provision fixture credentials only for an explicitly owned local backend. */
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

import { checkHostedFixtures, DEPLOY_KEYS, TARGET_KEYS, withTarget, type ConvexCommand } from "../../.github/actions/deploy-convex/fixture-target.ts";
export { assertHostedEnvironment, type ConvexCommand } from "../../.github/actions/deploy-convex/fixture-target.ts";

type Env = Record<string, string | undefined>;
const readEnv = (file: string): Env => fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};

export function assertAnonymousLaunch(...sources: Env[]): void {
  if (sources.some(source => TARGET_KEYS.some(key => source[key]))) throw new Error("Local startup refuses deployment keys or self-hosted overrides. Use a separate terminal and local checkout.");
  for (const source of sources) {
    if (source.CONVEX_DEPLOYMENT && !/^anonymous:[a-zA-Z0-9_-]+$/.test(source.CONVEX_DEPLOYMENT)) throw new Error("Local startup requires an anonymous deployment; refusing a cloud or ambiguous target.");
  }
}

/** The name the Convex CLI gives an agent-mode anonymous deployment that has no state of its own. */
export const SHARED_AGENT_DEPLOYMENT = "anonymous-agent";
const LEGACY_STATE = ".convex/anonymous-convex-backend-state";

/**
 * Where the Convex CLI keeps this checkout's anonymous backend, by the CLI's own rule:
 * project-local `packages/backend/.convex/local/default` when it has a config, otherwise a
 * legacy `~/.convex` deployment (an `anonymous-` name whose directory has a config), otherwise
 * project-local. An unknown or missing deployment name falls back to the agent default.
 */
export function convexState(root: string, fileEnv: Env, home: string = homedir()): { directory: string; deploymentName: string; legacy: boolean } {
  const local = path.join(root, "packages/backend/.convex/local/default");
  const named = fileEnv.CONVEX_DEPLOYMENT?.replace(/^anonymous:/, "");
  if (fs.existsSync(path.join(local, "config.json"))) return { directory: local, deploymentName: named ?? SHARED_AGENT_DEPLOYMENT, legacy: false };
  // A named deployment must be listed by the CLI (anonymous- prefix and a config); the agent
  // default only needs its legacy directory to exist (filePaths.js deploymentStateDir).
  const listed = (name: string) => name.startsWith("anonymous-") && fs.statSync(path.join(home, LEGACY_STATE, name, "config.json"), { throwIfNoEntry: false })?.isFile() === true;
  if (named && named !== SHARED_AGENT_DEPLOYMENT && listed(named)) return { directory: path.join(home, LEGACY_STATE, named), deploymentName: named, legacy: true };
  const shared = path.join(home, LEGACY_STATE, SHARED_AGENT_DEPLOYMENT);
  return fs.statSync(shared, { throwIfNoEntry: false })?.isDirectory() ? { directory: shared, deploymentName: SHARED_AGENT_DEPLOYMENT, legacy: true } : { directory: local, deploymentName: SHARED_AGENT_DEPLOYMENT, legacy: false };
}

/** Whether any process has the state's database open, as lsof sees it; "unknown" without a usable lsof. */
export function stateInUse(directory: string): "in-use" | "unused" | "unknown" {
  const database = path.join(directory, "convex_local_backend.sqlite3");
  if (!fs.existsSync(database)) return "unused";
  const result = spawnSync("lsof", ["-t", "--", database], { encoding: "utf8", timeout: 10_000 });
  if (result.stdout?.trim()) return "in-use";
  return result.error || (result.status !== 0 && result.status !== 1) ? "unknown" : "unused";
}

/**
 * Every checkout without project-local state attaches to a legacy `anonymous-agent` directory,
 * so stacks from different checkouts can share one database. Startup warns. A managed E2E run
 * (a Playwright port plan is present) refuses only while another process has that database
 * open, which is when sharing would corrupt it. The launcher checks while it holds the Convex
 * startup lock, so another startup on the same state has either finished (and holds the
 * database) or not begun.
 */
export function assertCheckoutState(root: string, fileEnv: Env, managed: boolean, warn: (message: string) => void, home: string = homedir(), inUse: (directory: string) => "in-use" | "unused" | "unknown" = stateInUse): void {
  const state = convexState(root, fileEnv, home);
  if (!state.legacy || state.deploymentName !== SHARED_AGENT_DEPLOYMENT) return;
  const message = `This checkout's local Convex backend uses the machine-wide legacy state ${state.directory}, which every checkout without project-local state shares. ` +
    "Give each checkout its own state: see \"Local Convex state per checkout\" in platform/docs/development.md.";
  const usage = managed ? inUse(state.directory) : "unused";
  if (usage === "in-use") throw new Error(`${message} Another local backend is using it right now; managed E2E runs refuse to share it.`);
  warn(`Warning: ${message}${usage === "unknown" ? " Could not check whether another backend is using it (lsof unavailable)." : ""}`);
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

export function provisionFixtures(command: ConvexCommand, runtime: "anonymous" | "local-aws", file: string, siteUrl: string): void {
  const previous = readEnv(file);
  const secret = previous.CONVEX_SITE_URL === siteUrl && /^[a-f0-9]{64}$/.test(previous.DEV_FIXTURE_SECRET ?? "") ? previous.DEV_FIXTURE_SECRET! : randomBytes(32).toString("hex");
  // Supply secrets on stdin, never in argv or logs. Set the flags atomically.
  command(["env", "set", "--force"], `DEV_FIXTURE_RUNTIME=${runtime}\nDEV_FIXTURE_SECRET=${secret}\nDEV_SEED_ENABLED=true\n`);
  fs.writeFileSync(file, `CONVEX_SITE_URL=${siteUrl}\nDEV_FIXTURE_SECRET=${secret}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const mode = process.argv[2];
    const fileEnv = readEnv(path.join(root, "packages/backend/.env.local"));
    const sources = [process.env, readEnv(path.join(root, ".env.local")), fileEnv, readEnv(path.join(root, "packages/backend/.env"))];
    // The Convex CLI takes CONVEX_DEPLOYMENT from the environment, then .env.local, then .env.
    const deployment = { CONVEX_DEPLOYMENT: process.env.CONVEX_DEPLOYMENT ?? fileEnv.CONVEX_DEPLOYMENT ?? readEnv(path.join(root, "packages/backend/.env")).CONVEX_DEPLOYMENT };
    if (mode === "check-launch") {
      assertAnonymousLaunch(...sources);
    } else if (mode === "check-state") {
      assertCheckoutState(root, deployment, Boolean(process.env.PLATFORM_E2E_PORTS), message => console.error(message));
    } else if (mode === "state-dir") {
      console.log(convexState(root, deployment).directory);
    } else if (mode === "anonymous") {
      assertAnonymousLaunch(...sources);
      const name = fileEnv.CONVEX_DEPLOYMENT?.replace(/^anonymous:/, "");
      if (!name) throw new Error("No anonymous backend is configured.");
      const state = convexState(root, fileEnv);
      const config = JSON.parse(fs.readFileSync(path.join(state.directory, "config.json"), "utf8"));
      if (state.legacy && config.deploymentName === undefined && state.deploymentName === name) config.deploymentName = name;
      const target = anonymousTarget(fileEnv, config);
      withTarget(root, target, command => provisionFixtures(command, "anonymous", path.join(root, ".env.e2e.local"), fileEnv.CONVEX_SITE_URL!));
    } else if (mode === "local-aws") {
      // The local compose target publishes precisely these loopback-bound ports.
      if (sources.some(source => DEPLOY_KEYS.some(key => source[key])) || process.env.CONVEX_SELF_HOSTED_URL !== "http://convex.localhost.floci.io:3310") throw new Error("Local AWS fixtures require the dedicated local compose backend.");
      const state = path.join(root, "infra/aws/local/.state");
      const key = fs.readFileSync(path.join(state, "convex-admin-key"), "utf8").trim();
      if (!key || key !== process.env.CONVEX_SELF_HOSTED_ADMIN_KEY) throw new Error("Local AWS admin key does not match the local target.");
      // Use the loopback socket, not public DNS, when provisioning credentials.
      withTarget(root, { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3310", CONVEX_SELF_HOSTED_ADMIN_KEY: key }, command => provisionFixtures(command, "local-aws", path.join(state, "fixture.env"), "http://convex.localhost.floci.io:3311"));
    } else if (mode === "check-hosted") {
      checkHostedFixtures(root);
      console.log("Hosted fixture preflight passed.");
    } else throw new Error("Usage: local-fixtures.ts check-launch|check-state|state-dir|anonymous|local-aws|check-hosted");
  } catch (error) { console.error(error instanceof Error ? error.message : "Local fixture configuration failed."); process.exitCode = 1; }
}
