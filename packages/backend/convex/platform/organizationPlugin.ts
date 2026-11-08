/**
 * Better Auth organization plugin, configured for the platform's organizations:
 * three built-in roles (owner, admin, member), email invitations, no teams and no custom
 * roles. Owners may delete an organization; the app's own data is then removed by its
 * `organizationData.ts` cleanup. The
 * session-assurance plugin admits only the `/organization/*` routes listed in
 * `authAssurance.ts`. See platform/docs/organizations.md.
 */
import type { GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { components, internal } from "../_generated/api";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { appConfig } from "@web-app-starter/app-config";

import type { DataModel } from "../_generated/dataModel";
import type { AuditAction } from "./auditTrailConstants";
import { runAuditEvent } from "./auditTrailHelpers";
import { sendLimitedAuthEmail } from "./authRateLimits";
import { organizationInvitationEmail } from "./sendAuthEmail";

const INVITATION_EXPIRY_DAYS = 7;

export function organizationPlugin(ctx: GenericCtx<DataModel>, siteUrl: string) {
  const audit = async (
    action: AuditAction,
    actor: { id: string; email: string },
    resource: string,
    meta?: Record<string, string>,
  ) => {
    await runAuditEvent(requireActionCtx(ctx), {
      happenedAt: Date.now(),
      actor: actor.email,
      authenticatedUserId: actor.id,
      sourceDetail: "auth-organization-hook",
      action,
      resource,
      status: "succeeded",
      meta: meta ? JSON.stringify(meta) : undefined,
    });
  };

  return organization({
    // Organizations are created by platform functions, together with their plan
    // (platform/docs/tenancy-and-billing.md); Better Auth's create route is off.
    allowUserToCreateOrganization: false,
    organizationLimit: 50,
    membershipLimit: 100,
    invitationLimit: 100,
    invitationExpiresIn: INVITATION_EXPIRY_DAYS * 24 * 60 * 60,
    // Re-inviting an address replaces its pending invitation (a fresh link and expiry).
    cancelPendingInvitationsOnReInvite: true,
    // Only an account that has proved it owns the invited address can accept.
    requireEmailVerificationOnInvitation: true,
    // Only owners may delete (Better Auth's default roles), after recent authentication
    // (authAssurance.ts). App data is removed afterwards, see afterDeleteOrganization.
    disableOrganizationDeletion: false,
    teams: { enabled: false },
    sendInvitationEmail: async ({ id, email, organization: org, inviter }) => {
      const url = `${siteUrl}/accept-invitation/${encodeURIComponent(id)}`;
      await sendLimitedAuthEmail(ctx, {
        to: email,
        type: "custom",
        urlOrCode: url,
        ...organizationInvitationEmail({
          inviterName: inviter.user.name || inviter.user.email,
          organizationName: org.name,
          productName: appConfig.identity.productName,
          url,
          expiresInDays: INVITATION_EXPIRY_DAYS,
        }),
      });
    },
    organizationHooks: {
      // The session-assurance plugin already admits only one canonical role and charges the
      // inviter's budget; this keeps a stored invitation canonical whatever the entry point.
      beforeCreateInvitation: async ({ invitation }) => {
        if (!["owner", "admin", "member"].includes(invitation.role)) {
          throw new APIError("BAD_REQUEST", { code: "INVALID_ROLE", message: "INVALID_ROLE" });
        }
      },
      afterCreateOrganization: async ({ organization: org, user }) => {
        await audit("organization.created", user, `organization:${org.id}`);
      },
      afterUpdateOrganization: async ({ organization: org, user }) => {
        if (org) await audit("organization.updated", user, `organization:${org.id}`);
      },
      // Better Auth deletes the members before the organization row; let them go.
      beforeDeleteOrganization: async ({ organization: org }) => {
        // A billing organization stays while it pays for another organization's plan.
        try {
          await requireActionCtx(ctx).runMutation(internal.platform.organizationOwnership.markDeleting, { organizationId: org.id });
        } catch (error) {
          if (error instanceof Error && error.message.includes("BILLING_ORGANIZATION_IN_USE")) throw new APIError("CONFLICT", { code: "BILLING_ORGANIZATION_IN_USE", message: "BILLING_ORGANIZATION_IN_USE" });
          throw error;
        }
      },
      // The adapter has already deleted the organization, and nothing here rolls back: record and
      // schedule the cleanup and audit first, so a failure ending the plan can't orphan its data.
      afterDeleteOrganization: async ({ organization: org, user }) => {
        await requireActionCtx(ctx).runMutation(internal.platform.organizations.startCleanup, { organizationId: org.id });
        await audit("organization.deleted", user, `organization:${org.id}`);
        // Its plan ends and its billing row is marked deleted; both stay as billing history.
        await requireActionCtx(ctx).runMutation(components.platform.billing.organizationDeleted, {
          organizationId: org.id, actor: { userId: user.id, email: user.email },
        });
      },
      afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
        await audit("organization.invitation.sent", inviter, `organization:${org.id}`, {
          invitationId: invitation.id, role: invitation.role,
        });
      },
      afterCancelInvitation: async ({ invitation, cancelledBy, organization: org }) => {
        await audit("organization.invitation.canceled", cancelledBy, `organization:${org.id}`, {
          invitationId: invitation.id,
        });
      },
      // Refuse with a reason; the member trigger enforces the same in the write's transaction.
      beforeAcceptInvitation: async ({ invitation, user }) => {
        const blocker = await requireActionCtx(ctx).runQuery(internal.platform.organizationOwnership.admissionBlocker, {
          organizationId: invitation.organizationId, userId: user.id, role: invitation.role,
        });
        if (blocker) throw new APIError(blocker === "ORGANIZATION_NOT_FOUND" ? "NOT_FOUND" : "CONFLICT", { code: blocker, message: blocker });
      },
      afterAcceptInvitation: async ({ invitation, user, organization: org }) => {
        await audit("organization.invitation.accepted", user, `organization:${org.id}`, {
          invitationId: invitation.id, role: invitation.role,
        });
      },
      afterRejectInvitation: async ({ invitation, user, organization: org }) => {
        await audit("organization.invitation.rejected", user, `organization:${org.id}`, {
          invitationId: invitation.id,
        });
      },
      // Removal, leaving and role changes are audited in auth.ts's after-hook, which knows who acted.
    },
  });
}
