/** Versioned, fail-closed operator projection. Stored private and historical evidence stays intact. */
import type { QueryCtx } from "../_generated/server";
import { components } from "../_generated/api";
import { operatorIdentity } from "./operatorAccess";
import { AUDIT_STATUSES } from "./auditTrailConstants";

// A fixed index key keeps customer actor/resource values out of pagination cursors as well as rows.
export const OPERATOR_AUDIT_SOURCE = "server:operator-audit:v1";
const PRIVATE_AUDIT_SOURCE = "server:private-audit:v1";

const operatorActions = new Set([
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
const operatorSources = new Set(["auth-hook", "agent-users", "agent-account", "admin-enrollment", "agent-access", "agent-task", "admin-mutation", "organization-control"]);

interface EventClassificationInput {
  authenticatedUserId?: string;
  sourceDetail: string;
  action: string;
}

/** Only server-classified new events are eligible; emails/action prefixes never classify history. */
export async function classifiedAuditSource(ctx: Pick<QueryCtx, "runQuery">, event: EventClassificationInput): Promise<string> {
  if (event.authenticatedUserId && operatorSources.has(event.sourceDetail) && operatorActions.has(event.action)) {
    try {
      if (await operatorIdentity(ctx, event.authenticatedUserId)) return OPERATOR_AUDIT_SOURCE;
    } catch {
      // Classification failures must preserve the original evidence under the private boundary.
    }
  }
  return `${PRIVATE_AUDIT_SOURCE}:${event.sourceDetail}`;
}

export interface OperatorAuditEvent {
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

type StoredEvent = OperatorAuditEvent & { legacyId?: string };

export async function projectOperatorAudit(ctx: Pick<QueryCtx, "runQuery">, event: StoredEvent): Promise<OperatorAuditEvent | null> {
  if (event.source !== OPERATOR_AUDIT_SOURCE || event.legacyId || !event.authenticatedUserId
    || !operatorActions.has(event.action) || !(AUDIT_STATUSES as readonly string[]).includes(event.status)) return null;
  const actor = await operatorIdentity(ctx, event.authenticatedUserId);
  if (!actor) return null;
  let resource = `operator:${actor._id}`;
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
    authenticatedUserId: actor._id, actor: actor.email, source: OPERATOR_AUDIT_SOURCE,
    action: event.action, status: event.status,
    // Raw resources, free-text reasons and historical JSON can contain customer identities/data.
    resource, newValue,
  };
}
