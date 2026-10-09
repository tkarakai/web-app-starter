import type { DefaultFunctionArgs, RegisteredMutation } from "convex/server";
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "./_generated/dataModel";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { enrolledOrgAdmin, isAppOperatorRole, MEMBER_LIMIT } from "./organizationModel";
import { MEMBERSHIP_MANAGEMENT_EXPERIENCE, ORG_ADMIN_MEMBERSHIP_ROLE } from "./organizationVocabulary";
import { requireIdentityMappingWritable } from "./organizationMigrationBarrier";

/** Every candidate read participates in the writer's OCC transaction. */
export async function assertEffectiveAdministrator(ctx: QueryCtx, organizationId: string) {
  const id = ctx.db.normalizeId("organization", organizationId);
  const org = id ? await ctx.db.get(id) : null;
  if (!org || org.lifecycle !== "active") return;
  const admins = await ctx.db.query("member").withIndex("organizationId_role", q =>
    q.eq("organizationId", org._id).eq("role", ORG_ADMIN_MEMBERSHIP_ROLE)).take(MEMBER_LIMIT + 1);
  if (admins.length > MEMBER_LIMIT) throw new Error("ORGANIZATION_MEMBER_LIMIT");
  if (org.experience === "personal") {
    const owner = admins.find(admin => admin.userId === org.personalOwnerId);
    const ownerId = owner ? ctx.db.normalizeId("user", owner.userId) : null;
    const user = ownerId ? await ctx.db.get(ownerId) : null;
    if (user && !isAppOperatorRole(user.role)) return;
    throw new Error("LAST_ORGANIZATION_ADMIN");
  }
  if (org.experience !== MEMBERSHIP_MANAGEMENT_EXPERIENCE) throw new Error("ORGANIZATION_CONTEXT_UNCLASSIFIED");
  for (const admin of admins) if (await enrolledOrgAdmin(ctx, admin)) return;
  throw new Error("LAST_ORGANIZATION_ADMIN");
}

/**
 * Pinned createApi (0.12.5) has no mandatory transaction hook. Keep its handlers,
 * argument/return validators and result semantics, but register a guarded handler
 * for BOTH invokeMutation (production) and _handler (convex-test). Optional
 * on*Handle arguments cannot opt out. Recheck this seam when upgrading Convex.
 */
export function guardAdapterMutation<Args extends DefaultFunctionArgs, Returns>(
  original: RegisteredMutation<"public", Args, Returns>,
) {
  // Convex strips @internal members from its published declarations, although
  // registration_impl and createApi expose them at runtime in the pinned build.
  type PinnedRegistration = {
    _handler: (ctx: MutationCtx, args: Args) => Returns;
    exportArgs: () => string;
    exportReturns: () => string;
  };
  const pinned = original as typeof original & PinnedRegistration;
  const guarded = mutation({
    handler: async (ctx, args: Args) => {
      const input = args.input as { model?: string } | undefined;
      if (input?.model && ["organizationEnrollments", "organizationSecurityPolicy", "organizationSecurityChanges", "organizationAudit", "organizationMigrationBarrier"].includes(input.model)) {
        throw new Error("USE_ORGANIZATION_SECURITY_API");
      }
      const users = new Set<string>();
      const organizations = new Set<string>();
      const revoke = new Map<string, boolean>();
      const triggers = new Triggers<DataModel>();
      triggers.register("user", async (_ctx, { oldDoc, newDoc }) => {
        if (!oldDoc || !newDoc || oldDoc.role !== newDoc.role || oldDoc.userId !== newDoc.userId || oldDoc.email !== newDoc.email
          || oldDoc.customerAdmission !== newDoc.customerAdmission) await requireIdentityMappingWritable(ctx);
        for (const row of [oldDoc, newDoc]) if (row) users.add(row._id);
        if (oldDoc && (!newDoc || oldDoc.email !== newDoc.email || oldDoc.emailVerified && !newDoc.emailVerified
          || oldDoc.banned !== newDoc.banned || oldDoc.role !== newDoc.role)) {
          revoke.set(oldDoc._id, true);
        }
        if (oldDoc?.twoFactorEnabled && !newDoc?.twoFactorEnabled) revoke.set(oldDoc._id, revoke.get(oldDoc._id) ?? false);
      });
      triggers.register("account", async (_ctx, { oldDoc, newDoc }) => {
        for (const row of [oldDoc, newDoc]) if (row) users.add(row.userId);
        if (oldDoc && (oldDoc.password !== newDoc?.password || oldDoc.userId !== newDoc?.userId
          || oldDoc.providerId !== newDoc?.providerId)) revoke.set(oldDoc.userId, true);
      });
      triggers.register("twoFactor", async (_ctx, { oldDoc, newDoc }) => {
        for (const row of [oldDoc, newDoc]) if (row) users.add(row.userId);
        if (oldDoc && (oldDoc.secret !== newDoc?.secret || oldDoc.verified && !newDoc?.verified
          || oldDoc.userId !== newDoc?.userId)) revoke.set(oldDoc.userId, revoke.get(oldDoc.userId) ?? false);
      });
      triggers.register("passkey", async (_ctx, { oldDoc, newDoc }) => {
        for (const row of [oldDoc, newDoc]) if (row) users.add(row.userId);
        if (oldDoc && (oldDoc.publicKey !== newDoc?.publicKey || oldDoc.credentialID !== newDoc?.credentialID
          || oldDoc.userId !== newDoc?.userId)) revoke.set(oldDoc.userId, revoke.get(oldDoc.userId) ?? false);
      });
      triggers.register("member", async (_ctx, { oldDoc, newDoc }) => {
        await requireIdentityMappingWritable(ctx);
        if (newDoc && (newDoc.adminEnrolledAt !== oldDoc?.adminEnrolledAt || newDoc.adminFactorId !== oldDoc?.adminFactorId)
          && (newDoc.adminEnrolledAt || newDoc.adminFactorId)) throw new Error("USE_ORGANIZATION_SECURITY_API");
        for (const row of [oldDoc, newDoc]) if (row) organizations.add(row.organizationId);
      });
      triggers.register("organization", async (_ctx, { newDoc }) => {
        await requireIdentityMappingWritable(ctx);
        if (newDoc) organizations.add(newDoc._id);
      });
      triggers.register("organizationEnrollments", async (_ctx, { oldDoc, newDoc }) => {
        for (const row of [oldDoc, newDoc]) if (row) organizations.add(row.organizationId);
      });
      triggers.register("organizationInvitationClaims", async () => { await requireIdentityMappingWritable(ctx); });
      triggers.register("invitation", async () => { await requireIdentityMappingWritable(ctx); });
      const result = await pinned._handler(triggers.wrapDB(ctx), args);
      for (const userId of users) {
        const memberships = await ctx.db.query("member").withIndex("userId", q => q.eq("userId", userId)).take(101);
        if (memberships.length > 100) throw new Error("ORGANIZATION_CONTEXT_LIMIT");
        if (!memberships.some(member => member.adminEnrolledAt)) revoke.delete(userId);
        for (const member of memberships) organizations.add(member.organizationId);
      }
      for (const organizationId of organizations) await assertEffectiveAdministrator(ctx, organizationId);
      for (const [userId, primary] of revoke) {
        const sessions = await ctx.db.query("session").withIndex("userId", q => q.eq("userId", userId)).collect();
        for (const session of sessions) await ctx.db.patch(session._id, {
          strongVerifiedAt: 0, strongFactorId: "", strongFactorType: "",
          ...(primary ? { primaryVerifiedAt: 0 } : {}),
        });
      }
      return result;
    },
  });
  const registration = guarded as typeof guarded & Pick<PinnedRegistration, "exportArgs" | "exportReturns">;
  registration.exportArgs = pinned.exportArgs;
  registration.exportReturns = pinned.exportReturns;
  return guarded;
}
