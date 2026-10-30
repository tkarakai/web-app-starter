/** Historic app-operator audit wire values. Preserve records, source indexes and writer output. */
export const APP_OPERATOR_AUDIT_SOURCE = "server:operator-audit:v1";
export const LEGACY_APP_OPERATOR_AUDIT_RESOURCE_PREFIX = "operator";

/** Compatibility sourceDetail tokens; their spelling does not define product terminology. */
export const LEGACY_APP_OPERATOR_AUDIT_SOURCE_DETAILS = {
  authentication: "auth-hook",
  identityAdministration: "agent-users",
  accountSelfService: "agent-account",
  enrollment: "admin-enrollment",
  agentAccess: "agent-access",
  agentTask: "agent-task",
  administrativeMutation: "admin-mutation",
  organizationAvailability: "organization-control",
} as const;

export const LEGACY_APP_OPERATOR_AGENT_SURFACE_AUDIT_SOURCE = "server:agent-surface";
// These historic writers remain outside the existing operator-source allowlist.
export const LEGACY_APP_OPERATOR_TASK_ADMIN_AUDIT_SOURCE_DETAIL = "agent-tasks";
export const LEGACY_AUTH_ENDPOINT_AUDIT_SOURCE_DETAIL = "auth-endpoint-hook";
