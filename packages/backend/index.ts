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
