// Test-only canonical component enrollment. No direct database grant or runtime bypass.
import { components } from "../convex/_generated/api";
import { createTestEnv } from "../convex/test.modules";
import { sha256Hex } from "../convex/platform/tokenHash";

export async function enrollOrganizationAdminForTest(t: ReturnType<typeof createTestEnv>, args: {
  organizationId: string; userId: string; name?: string; slug?: string;
}) {
  const bound = { organizationId: args.organizationId, userId: args.userId };
  const context = await t.query(components.betterAuth.organizations.context, bound);
  if (context.experience === "personal") await t.mutation(components.betterAuth.organizations.beginMembershipManagement, {
    ...bound, name: args.name ?? context.name, slug: args.slug ?? `test-${args.organizationId.slice(-16)}`,
  });
  let account = await t.query(components.betterAuth.adapter.findOne, {
    model: "account", where: [{ field: "providerId", value: "credential" }, { field: "userId", value: args.userId }],
  });
  if (!account) account = await t.mutation(components.betterAuth.adapter.create, { input: { model: "account", data: {
    userId: args.userId, accountId: args.userId, providerId: "credential", password: "fixture-credential-hash",
    createdAt: Date.now(), updatedAt: Date.now(),
  } } });
  const factor = await t.query(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: args.userId }] });
  if (!account.password || !factor?.verified) throw new Error("TEST_SECURITY_FIXTURE_REQUIRED");
  await t.mutation(components.betterAuth.organizations.recordPasswordProof, { ...bound, credentialProof: sha256Hex(account.password) });
  await t.mutation(components.betterAuth.organizations.acknowledgeRecovery, { ...bound,
    factorId: factor._id, backupCodesProof: sha256Hex(factor.backupCodes) });
  return t.mutation(components.betterAuth.organizations.completeEnrollment, { ...bound, requirePasskey: false });
}
