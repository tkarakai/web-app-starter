/** In-memory acceptance helper: runs the production migration, including every verifier. */
import { makeFunctionReference } from "convex/server";
import { vi } from "vitest";
import type { TestConvex } from "convex-test";
import type { DataModel } from "../convex/_generated/dataModel";
import { organizationMigrationRegistry } from "../convex/organizationMigrationRegistry";
import { organizationRegistryHash } from "../convex/platform/organizationMigrationRegistry";
export async function completeOrganizationMigration(t: Pick<TestConvex<DataModel>, "mutation">) {
  const deployment = process.env.CONVEX_CLOUD_URL || "https://organization-test.convex.cloud";
  const deploymentVersion = "registered-organization-test-v1";
  vi.stubEnv("CONVEX_CLOUD_URL", deployment);
  vi.stubEnv("ORGANIZATION_DEPLOYMENT_VERSION", deploymentVersion);
  vi.stubEnv("ORGANIZATION_REGISTRY_HASH", organizationRegistryHash(organizationMigrationRegistry));
  await t.mutation(makeFunctionReference<"mutation">("organizationMigration:begin"), { confirmDeployment: deployment, deploymentVersion });
  for (let batch = 0; batch < 200; batch++) {
    const result = await t.mutation(makeFunctionReference<"mutation">("organizationMigration:step"), { batchSize: 50 });
    if (result.complete) {
      if (result.stage !== "ready") await t.mutation(makeFunctionReference<"mutation">("organizationMigration:finalize"), {});
      return;
    }
  }
  throw new Error("Organization test migration exceeded batch budget");
}
