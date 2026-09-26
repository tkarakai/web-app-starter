import type { FunctionReturnType } from "convex/server";
import type { api } from "./convex/_generated/api";

export { api, internal } from "./convex/_generated/api";
export type { Id, Doc, DataModel } from "./convex/_generated/dataModel";
export type {
  EmailTemplate,
  TemplateVariables,
  VerificationTemplateVariables,
} from "./convex/emailTemplates";
export {
  TEMPLATE_VARIABLES,
  VERIFICATION_TEMPLATE_VARIABLES,
  renderTemplate,
  renderTemplateGeneric,
  formatDurationHuman,
} from "./convex/emailTemplates";
export type { SessionInfo } from "./convex/sessions";
export type { DeviceInfo } from "./convex/parseUserAgent";
export { parseUserAgent } from "./convex/parseUserAgent";
export {
  AUDIT_ACTIONS,
  AUDIT_STATUSES,
  AUDIT_SOURCE_TRANSPORTS,
} from "@repo/convex-platform/constants";
export type {
  AuditAction,
  AuditStatus,
  AuditSourceTransport,
} from "@repo/convex-platform/constants";
export { scheduleAuditEvent, runAuditEvent } from "./convex/platform/auditTrailHelpers";
export type { InsertEventArgs } from "./convex/platform/auditTrailHelpers";

// SPIKE: audit events now live in the platform component, so there is no
// `Doc<"auditTrail">` in the app data model. The type comes from the wrapper.
export type AuditTrailEvent = FunctionReturnType<
  typeof api.platform.auditTrail.list
>["page"][number];
