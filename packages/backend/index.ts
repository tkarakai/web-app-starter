export { api, internal } from "./convex/_generated/api";
export type { Id, Doc, DataModel } from "./convex/_generated/dataModel";
export type {
  EmailTemplate,
  TemplateVariables,
  VerificationTemplateVariables,
} from "./convex/platform/emailTemplates";
export {
  TEMPLATE_VARIABLES,
  VERIFICATION_TEMPLATE_VARIABLES,
  renderTemplate,
  renderTemplateGeneric,
  formatDurationHuman,
} from "./convex/platform/emailTemplates";
export type { SessionInfo } from "./convex/platform/sessions";
export type { DeviceInfo } from "./convex/platform/parseUserAgent";
export { parseUserAgent } from "./convex/platform/parseUserAgent";
export {
  AUDIT_ACTIONS,
  AUDIT_STATUSES,
  AUDIT_SOURCE_TRANSPORTS,
} from "./convex/platform/auditTrailConstants";
export type {
  AuditAction,
  AuditStatus,
  AuditSourceTransport,
} from "./convex/platform/auditTrailConstants";
export { scheduleAuditEvent, runAuditEvent } from "./convex/platform/auditTrailHelpers";
export type { InsertEventArgs } from "./convex/platform/auditTrailHelpers";

import type { FunctionReturnType } from "convex/server";
import type { api, internal } from "./convex/_generated/api";
/** Audit row returned by the platform wrapper; component IDs are strings. */
export type AuditTrailEvent = FunctionReturnType<typeof api.platform.auditTrail.list>["page"][number];

/** Announcement storage shape exposed by wrappers; IDs are component strings. */
export type Announcement = Omit<NonNullable<FunctionReturnType<typeof api.platform.announcements.list>>[number], "isActiveNow" | "isPublishNowEligible" | "status">;

/** Platform component rows; IDs are opaque strings across the app boundary. */
export type WaitlistEntry = Omit<FunctionReturnType<typeof api.platform.waitlist.list>["page"][number], "invitationExpired">;
export type AdminInvitation = Omit<FunctionReturnType<typeof api.platform.adminInvitations.list>["page"][number], "invitationExpired">;
export type InvitationToken = NonNullable<FunctionReturnType<typeof api.platform.waitlistTokens.listByEntry>>[number];

export type AdminEmail = FunctionReturnType<typeof internal.platform.adminEmails.list>[number];
