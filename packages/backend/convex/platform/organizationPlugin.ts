/**
 * Better Auth organization plugin, configured for the platform's organizations:
 * three built-in roles (owner, admin, member), email invitations, no teams, no custom
 * roles, and no organization deletion (app data would need a cascade). The
 * session-assurance plugin admits only the `/organization/*` routes listed in
 * `authAssurance.ts`. See platform/docs/organizations.md.
 */
import type { GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { appConfig } from "@web-app-starter/app-config";

import { internal } from "../_generated/api";
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
    allowUserToCreateOrganization: true,
    organizationLimit: 50,
    membershipLimit: 100,
    invitationLimit: 100,
    invitationExpiresIn: INVITATION_EXPIRY_DAYS * 24 * 60 * 60,
    // Re-inviting an address replaces its pending invitation (a fresh link and expiry).
    cancelPendingInvitationsOnReInvite: true,
    // Only an account that has proved it owns the invited address can accept.
    requireEmailVerificationOnInvitation: true,
    disableOrganizationDeletion: true,
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
      beforeCreateInvitation: async ({ inviter }) => {
        const limit = await requireActionCtx(ctx).runMutation(internal.platform.rateLimits.consumeAuthRateLimit, {
          name: "organizationInvite",
          key: inviter.id,
        });
        if (!limit.ok) {
          throw new APIError("TOO_MANY_REQUESTS", { code: "RATE_LIMITED", message: "Too many invitations. Please try again later." });
        }
      },
      afterCreateOrganization: async ({ organization: org, user }) => {
        await audit("organization.created", user, `organization:${org.id}`);
      },
      afterUpdateOrganization: async ({ organization: org, user }) => {
        if (org) await audit("organization.updated", user, `organization:${org.id}`);
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
