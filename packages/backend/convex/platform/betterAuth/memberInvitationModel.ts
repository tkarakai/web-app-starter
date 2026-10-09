import type { QueryCtx } from "./_generated/server";
import { requireOrgAdmin, organizationUser, MEMBER_LIMIT, organization } from "./organizationModel";
import type { Id } from "./_generated/dataModel";
import { MEMBERSHIP_MANAGEMENT_EXPERIENCE, ORG_ADMIN_MEMBERSHIP_ROLE, ORG_MEMBER_ROLE } from "./organizationVocabulary";

export const invitationRole = (role: string | null | undefined) => {
  if (role !== ORG_MEMBER_ROLE && role !== ORG_ADMIN_MEMBERSHIP_ROLE) throw new Error("INVALID_MEMBER_INVITATION");
  return role;
};

export async function liveInvitation(ctx: QueryCtx, id: Id<"invitation">, organizationId?: string, pending = true) {
  const invite = await ctx.db.get(id);
  if (!invite || invite.expiresAt <= Date.now() || (organizationId !== undefined && invite.organizationId !== organizationId)
    || (pending ? invite.status !== "pending" : !["pending", "accepted"].includes(invite.status))) throw new Error("INVALID_MEMBER_INVITATION");
  invitationRole(invite.role);
  const org = await organization(ctx, invite.organizationId);
  if (org.experience !== MEMBERSHIP_MANAGEMENT_EXPERIENCE) throw new Error("INVALID_MEMBER_INVITATION");
  await requireOrgAdmin(ctx, org._id, invite.inviterId);
  return { invite, org };
}

export async function invitationByToken(ctx: QueryCtx, tokenHash: string, organizationId: string, pending = true) {
  const invite = await ctx.db.query("invitation").withIndex("tokenHash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!invite) throw new Error("INVALID_MEMBER_INVITATION");
  return liveInvitation(ctx, invite._id, organizationId, pending);
}

export async function registrationClaim(ctx: QueryCtx, capabilityHash: string, email: string) {
  const claim = await ctx.db.query("organizationInvitationClaims").withIndex("capabilityHash", q => q.eq("capabilityHash", capabilityHash)).unique();
  if (!claim || claim.expiresAt <= Date.now()) throw new Error("INVALID_MEMBER_INVITATION");
  const { invite, org } = await liveInvitation(ctx, claim.invitationId);
  if (invite.tokenHash !== claim.invitationTokenHash || invite.email !== email) throw new Error("INVALID_MEMBER_INVITATION");
  return { claim, invite, org };
}

export async function recipient(ctx: QueryCtx, tokenHash: string, organizationId: string, userId: string, pending = true) {
  const { invite, org } = await invitationByToken(ctx, tokenHash, organizationId, pending);
  const user = await organizationUser(ctx, userId);
  if (user.email.trim().toLowerCase() !== invite.email) throw new Error("INVITATION_RECIPIENT_MISMATCH");
  return { invite, org, user };
}

export async function membershipCapacity(ctx: QueryCtx, organizationId: string) {
  const members = await ctx.db.query("member").withIndex("organizationId", q => q.eq("organizationId", organizationId)).take(MEMBER_LIMIT + 1);
  if (members.length >= MEMBER_LIMIT) throw new Error("ORGANIZATION_MEMBER_LIMIT");
}
