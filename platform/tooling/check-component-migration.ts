#!/usr/bin/env node
/** Read-only deployment guard. Uses the same selected deployment/key as `convex deploy`. */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { tmpdir } from "node:os";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
const TABLES = ["announcements", "appSettings", "adminEmails", "waitlistEntries", "invitationTokens", "adminInvitations", "auditTrail"];
export type ConvexRead = (args: string[]) => unknown;
export function checkMigration(read: ConvexRead): "fresh" | "complete" {
  try {
    const status = read(["run", "platform/componentMigration:deploymentStatus"]) as { phase?: string } | null;
    if (status?.phase === "complete") return "complete";
    if (status?.phase && status.phase !== "not-started") throw new Error("Migration is still " + status.phase);
  } catch (error) {
    // A pre-v2/fresh backend has no receipt endpoint. The table probes below must
    // still succeed; access/network failures are never interpreted as empty data.
    if (error instanceof Error && error.message.startsWith("Migration is still")) throw error;
  }
  for (const table of TABLES) {
    const rows = read(["data", table, "--limit", "1", "--format", "json"]);
    if (!Array.isArray(rows)) throw new Error("Cannot establish whether legacy table is empty: " + table);
    if (rows.length) throw new Error("Legacy platform data needs the additive bridge migration before deploying v2: " + table + ". See platform/docs/component-data-migration.md.");
  }
  return "fresh";
}
export function parseRead(stdout: string, stderr: string, command: string): unknown {
  if (command === "data" && !stdout.trim() && stderr.split(/\r?\n/).includes("There are no documents in this table.")) return [];
  try { return JSON.parse(stdout); } catch { throw new Error("Convex returned an unexpected response."); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let credentialsDirectory: string | undefined;
  try {
    // `run` otherwise defaults to dev while `deploy` defaults to prod. Require
    // explicit shared credentials so those commands cannot silently check two targets.
    if (!process.env.CONVEX_DEPLOY_KEY && !(process.env.CONVEX_SELF_HOSTED_URL && process.env.CONVEX_SELF_HOSTED_ADMIN_KEY)) {
      throw new Error("Set CONVEX_DEPLOY_KEY (or explicit self-hosted credentials) for the same target used by convex deploy.");
    }
    credentialsDirectory = fs.mkdtempSync(path.join(tmpdir(), "component-migration-check-"));
    const envFile = path.join(credentialsDirectory, ".env");
    const keys = process.env.CONVEX_DEPLOY_KEY ? ["CONVEX_DEPLOY_KEY"] : ["CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"];
    fs.writeFileSync(envFile, keys.map(key => key + "=" + JSON.stringify(process.env[key])).join("\n") + "\n", { mode: 0o600 });
    const read: ConvexRead = args => {
      // Never print captured data or command errors (which may include row values).
      const result = spawnSync("bunx", ["--no-install", "convex", ...args, "--env-file", envFile], { cwd: path.resolve("packages/backend"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error("Convex read failed; verify deployment access and connectivity.");
      return parseRead(result.stdout, result.stderr, args[0]);
    };
    console.log("Component migration deployment check: " + checkMigration(read));
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { if (credentialsDirectory) fs.rmSync(credentialsDirectory, { recursive: true, force: true }); }
}
