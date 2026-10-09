/** Versioned, fail-closed app-operator projection. Stored private and historical evidence stays intact. */
import type { QueryCtx } from "../_generated/server";
import { components } from "../_generated/api";
import { appOperatorIdentity } from "./appOperatorAccess";
import { APP_OPERATOR_AUDIT_SOURCE, LEGACY_APP_OPERATOR_AUDIT_RESOURCE_PREFIX, LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS } from "./appOperatorAuditCompatibility";
export { APP_OPERATOR_AUDIT_SOURCE } from "./appOperatorAuditCompatibility";
import { AUDIT_STATUSES } from "./auditTrailConstants";

// A fixed index key keeps organization-user actor/resource values out of pagination cursors as well as rows.
/** @deprecated Use APP_OPERATOR_AUDIT_SOURCE; the historic wire value is unchanged. */
export const OPERATOR_AUDIT_SOURCE = APP_OPERATOR_AUDIT_SOURCE;
const PRIVATE_AUDIT_SOURCE = "server:private-audit:v1";

const appOperatorActions = new Set([
  "auth.sign_in", "auth.sign_out", "auth.sign_up", "auth.password_changed",
  "auth.two_factor.setup_started", "auth.two_factor.enabled", "auth.two_factor.disabled",
  "auth.two_factor.verify_totp", "auth.two_factor.verify_backup_code", "auth.two_factor.backup_codes_regenerated",
  "auth.passkey.added", "auth.passkey.renamed", "auth.passkey.deleted", "auth.passkey.sign_in",
  "auth.session.revoked", "auth.session.revoked_all", "user.profile_updated",
  "admin.user.banned", "admin.user.unbanned", "admin.session.revoked", "admin.session.revoked_all",
  "admin.onboarding.completed", "admin.agent_grant_revoked", "admin.agent_task_canceled",
  "admin.mfa_policy_changed", "admin.email_verification_policy_changed",
  "admin.organization.lifecycle_changed",
]);
const appOperatorSources = new Set<string>(Object.values(LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS));

interface EventClassificationInput {
  authenticatedUserId?: string;
  sourceDetail: string;
  action: string;
}

/** Only server-classified new events are eligible; emails/action prefixes never classify history. */
export async function classifiedAuditSource(ctx: Pick<QueryCtx, "runQuery">, event: EventClassificationInput): Promise<string> {
  if (event.authenticatedUserId && appOperatorSources.has(event.sourceDetail) && appOperatorActions.has(event.action)) {
    try {
      if (await appOperatorIdentity(ctx, event.authenticatedUserId)) return APP_OPERATOR_AUDIT_SOURCE;
    } catch {
      // Classification failures must preserve the original evidence under the private boundary.
    }
  }
  return `${PRIVATE_AUDIT_SOURCE}:${event.sourceDetail}`;
}

export interface AppOperatorAuditEvent {
  _id: string;
  _creationTime: number;
  happenedAt: number;
  authenticatedUserId?: string;
  actor: string;
  source: string;
  action: string;
  resource: string;
  status: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  meta?: string;
  truncatedFields?: string;
}

type StoredEvent = AppOperatorAuditEvent & { legacyId?: string };

export async function projectAppOperatorAudit(ctx: Pick<QueryCtx, "runQuery">, event: StoredEvent): Promise<AppOperatorAuditEvent | null> {
  if (event.source !== APP_OPERATOR_AUDIT_SOURCE || event.legacyId || !event.authenticatedUserId
    || !appOperatorActions.has(event.action) || !(AUDIT_STATUSES as readonly string[]).includes(event.status)) return null;
  const actor = await appOperatorIdentity(ctx, event.authenticatedUserId);
  if (!actor) return null;
  let resource = `${LEGACY_APP_OPERATOR_AUDIT_RESOURCE_PREFIX}:${actor._id}`;
  let newValue: string | undefined;
  if (event.action === "admin.organization.lifecycle_changed") {
    if (!event.resource.startsWith("organization:")) return null;
    const organization = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "organization", where: [{ field: "_id", value: event.resource.slice("organization:".length) }],
    });
    if (!organization) return null;
    resource = `organization:${organization._id}`;
    if (event.newValue === "active" || event.newValue === "disabled") newValue = event.newValue;
  }
  return {
    _id: event._id, _creationTime: event._creationTime, happenedAt: event.happenedAt,
    authenticatedUserId: actor._id, actor: actor.email, source: APP_OPERATOR_AUDIT_SOURCE,
    action: event.action, status: event.status,
    // Raw resources, free-text reasons and historical JSON can contain organization-user identities/data.
    resource, newValue,
  };
}

/** @deprecated Use AppOperatorAuditEvent. */
export type OperatorAuditEvent = AppOperatorAuditEvent;
/** @deprecated Use projectAppOperatorAudit. */
export const projectOperatorAudit = projectAppOperatorAudit;
