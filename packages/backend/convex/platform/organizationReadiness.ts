import { query } from "../_generated/server";
import { getAuth } from "./functions";
import type { QueryCtx } from "../_generated/server";

export const ORGANIZATION_MIGRATION_CONTRACT_VERSION = 1;
export const ORGANIZATION_MIGRATION_KEY = "organization-v1" as const;
export function organizationDeployment() {
  const deployment = process.env.CONVEX_CLOUD_URL;
  const deploymentVersion = process.env.ORGANIZATION_DEPLOYMENT_VERSION;
  const registryHash = process.env.ORGANIZATION_REGISTRY_HASH;
  if (!deployment || !deploymentVersion || !registryHash) throw new Error("ORGANIZATION_DEPLOYMENT_UNBOUND");
  return { deployment, deploymentVersion, registryHash };
}
export async function readOrganizationReadiness(ctx: Pick<QueryCtx, "db">) {
  const receipt = await ctx.db.query("organizationMigrationState").withIndex("by_key", q => q.eq("key", ORGANIZATION_MIGRATION_KEY)).unique();
  let ready = false;
  try {
    const identity = organizationDeployment();
    ready = receipt?.phase === "ready" && receipt.legacyRetired && receipt.deployment === identity.deployment
      && receipt.deploymentVersion === identity.deploymentVersion && receipt.registryHash === identity.registryHash;
  } catch { /* Missing deployment binding never authorizes cutover. */ }
  return { deployment: process.env.CONVEX_CLOUD_URL ?? null, ready, phase: receipt?.phase ?? "not-started", deploymentVersion: receipt?.deploymentVersion ?? null,
    registryHash: receipt?.registryHash ?? null, receipt };
}
export async function requireOrganizationReadiness(ctx: Pick<QueryCtx, "db">) {
  const status = await readOrganizationReadiness(ctx);
  if (!status.ready) throw new Error("ORGANIZATION_MIGRATION_REQUIRED");
  return status.receipt!;
}
/** This DB read and the caller's write share one transaction: begin fences concurrent writers. */
export async function assertOrganizationWriteAllowed(ctx: Pick<QueryCtx, "db">, plane: "legacy" | "tenant" | "control") {
  const status = await readOrganizationReadiness(ctx);
  if (status.receipt?.phase === "maintenance") throw new Error("ORGANIZATION_MAINTENANCE");
  if (plane === "legacy" && status.receipt?.legacyRetired) throw new Error("ORGANIZATION_LEGACY_RETIRED");
  if ((plane === "tenant" || status.receipt) && !status.ready) throw new Error("ORGANIZATION_MIGRATION_REQUIRED");
}

/** Public-safe rollout state: no owner mappings, row IDs, hashes or deployment evidence. */
export const status = query({ args: {}, handler: async ctx => {
  if (!await getAuth(ctx)) return null;
  const readiness = await readOrganizationReadiness(ctx);
  return { ready: readiness.ready, phase: readiness.phase };
} });
