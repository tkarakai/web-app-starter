import { appConfig } from "@web-app-starter/app-config";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import { sendAuthEmail } from "./sendAuthEmail";
import { escapeHtml, withTextFooter } from "./emailTemplates";
import { sha256Hex } from "./tokenHash";
import { requireOrganizationReadiness } from "./organizationReadiness";

const deliveryArgs = { organizationId: v.string(), invitationId: v.string(), token: v.string(), version: v.number() };

export const snapshot = internalQuery({
  args: deliveryArgs,
  handler: async (ctx, { token, ...args }) => {
    await requireOrganizationReadiness(ctx);
    return ctx.runQuery(components.betterAuth.memberInvitations.delivery, { ...args, tokenHash: sha256Hex(token) });
  },
});

/** Retries recheck current organization/inviter/invitation state and capability generation. */
export const send = internalAction({
  args: { ...deliveryArgs, attempt: v.number() },
  handler: async (ctx, { attempt, ...args }) => {
    const receipt = { organizationId: args.organizationId, invitationId: args.invitationId,
      tokenHash: sha256Hex(args.token), version: args.version };
    try {
      const invitation = await ctx.runQuery(internal.platform.memberInvitationDelivery.snapshot, args);
      if (!invitation) return;
      const reserved = await ctx.runMutation(internal.platform.rateLimits.reserveAuthEmail,
        { recipientKey: sha256Hex(invitation.email.trim().toLowerCase()) });
      if (!reserved.ok) throw new Error("EMAIL_RATE_LIMITED");
      const site = process.env.SITE_URL?.split(",")[0]?.trim();
      if (!site) throw new Error("SITE_URL_NOT_CONFIGURED");
      const url = new URL(`/${appConfig.i18n.defaultLocale}/organization-invitation`, site);
      // A fragment keeps the invitation capability out of server access logs and referrers.
      url.hash = new URLSearchParams({ organizationId: args.organizationId, token: args.token }).toString();
      const role = invitation.role === "org-admin" ? "organization administrator" : "member";
      const title = `Invitation to ${invitation.organizationName}`;
      const body = `You have been invited to ${invitation.organizationName} as a ${role}.`;
      const message = withTextFooter({ subject: title,
        html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(url.href)}">Review invitation</a></p><p>This invitation expires in seven days. Membership does not share private projects or files.</p>`,
        text: `${body}\n\nReview invitation: ${url.href}\n\nThis invitation expires in seven days. Membership does not share private projects or files.`,
      });
      await sendAuthEmail({ to: invitation.email, type: "custom", ...message, previewUrl: url.href });
      await ctx.runMutation(components.betterAuth.memberInvitations.recordDelivery, { ...receipt, sent: true });
    } catch {
      // Do not persist provider errors, which may include addresses or invitation capabilities.
      const recorded = await ctx.runMutation(components.betterAuth.memberInvitations.recordDelivery, { ...receipt, sent: false });
      if (recorded.retry && attempt < 2) await ctx.scheduler.runAfter(60_000 * (attempt + 1),
        internal.platform.memberInvitationDelivery.send, { ...args, attempt: attempt + 1 });
    }
  },
});
