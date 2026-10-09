#!/usr/bin/env node
/** Provision fixture credentials only for an explicitly owned local backend. */
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

import { checkHostedFixtures, DEPLOY_KEYS, TARGET_KEYS, withTarget, type ConvexCommand } from "../../.github/actions/deploy-convex/fixture-target.ts";
import { inspectOrganizationSource, prepareOrganizationDeployment, verifyOrganizationDeployment } from "../../.github/actions/deploy-convex/organization-target.ts";
export { assertHostedEnvironment, type ConvexCommand } from "../../.github/actions/deploy-convex/fixture-target.ts";

type Env = Record<string, string | undefined>;
const readEnv = (file: string): Env => fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};

export function assertAnonymousLaunch(...sources: Env[]): void {
  if (sources.some(source => TARGET_KEYS.some(key => source[key]))) throw new Error("Local startup refuses deployment keys or self-hosted overrides. Use a separate terminal and local checkout.");
  for (const source of sources) {
    if (source.CONVEX_DEPLOYMENT && !/^anonymous:[a-zA-Z0-9_-]+$/.test(source.CONVEX_DEPLOYMENT)) throw new Error("Local startup requires an anonymous deployment; refusing a cloud or ambiguous target.");
  }
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
    if (mode === "check-launch") {
      assertAnonymousLaunch(...sources);
    } else if (mode === "anonymous" || mode === "organization") {
      assertAnonymousLaunch(...sources);
      const name = fileEnv.CONVEX_DEPLOYMENT?.replace(/^anonymous:/, "");
      if (!name) throw new Error("No anonymous backend is configured.");
      const projectConfig = path.join(root, "packages/backend/.convex/local/default/config.json");
      const projectLocal = fs.existsSync(projectConfig);
      const config = JSON.parse(fs.readFileSync(projectLocal ? projectConfig : path.join(homedir(), ".convex/anonymous-convex-backend-state", name, "config.json"), "utf8"));
      if (!projectLocal && config.deploymentName === undefined) config.deploymentName = name;
      const target = anonymousTarget(fileEnv, config);
      if (mode === "anonymous") {
        withTarget(root, target, command => provisionFixtures(command, "anonymous", path.join(root, ".env.e2e.local"), fileEnv.CONVEX_SITE_URL!));
      } else {
        const source = inspectOrganizationSource(root);
        withTarget(root, target, command => {
          prepareOrganizationDeployment(command, source);
          verifyOrganizationDeployment(command, source);
        });
      }
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
    } else throw new Error("Usage: local-fixtures.ts check-launch|anonymous|organization|local-aws|check-hosted");
  } catch (error) { console.error(error instanceof Error ? error.message : "Local fixture configuration failed."); process.exitCode = 1; }
}
