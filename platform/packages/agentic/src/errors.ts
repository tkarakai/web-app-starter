/** Public error codes an agent may see. Anything else is reported generically. */
const PUBLIC_CODES = ["RECENT_AUTHENTICATION_REQUIRED", "INVALID_AGENT_TOKEN", "UNKNOWN_CAPABILITY", "WRITE_OUTPUT_CANNOT_BE_REPLAYED", "INVALID_RESULT_OFFSET", "ANNOUNCEMENT_NOT_FOUND", "NAME_REQUIRED", "BANNER_TEXT_REQUIRED", "INVALID_SCHEDULE", "NOT_ADMIN", "RATE_LIMITED", "SURFACE_DISABLED", "PROTECTED_ADMIN", "USER_NOT_FOUND", "INVALID_PAGE_SIZE", "BATCH_TOO_LARGE", "SESSION_NOT_FOUND", "GRANT_NOT_FOUND", "PASSKEY_NOT_FOUND", "CONTROL_UNAVAILABLE", "INVALID_ADMIN_PATH", "FIELD_NOT_EDITABLE", "INVALID_SELECT_OPTION", "NOT_TOGGLE", "INVALID_INPUT", "INVALID_KEY", "INVALID_VALUE", "TASK_LIMIT_REACHED", "TASK_MESSAGE_LIMIT", "MESSAGE_ID_REUSED", "CONTEXT_MISMATCH", "TASK_NOT_CONTINUABLE", "CANNOT_BAN_SELF", "CANNOT_DELETE_SELF", "INVALID_BAN", "INVALID_PROFILE", "TOO_MANY_SESSIONS", "TOO_MANY_USER_RECORDS"];

/**
 * Organization refusals, each with the step that resolves it. Only the code and this fixed
 * hint are returned: the backend message names organizations, which an agent must not be fed.
 * Order matters where one code contains another.
 */
const ORGANIZATION_CODES: [code: string, recovery: string][] = [
  ["OWNER_SUCCESSOR_REQUIRED", "an organization would be left without an owner who can act; read organizations_forUser for banSuccessor candidates and pass successors"],
  ["ORGANIZATION_OWNER_REQUIRED", "the change would leave members without an owner who can act; make another member an owner first"],
  ["INVALID_SUCCESSOR", "each successor must be a current member, not the user being changed, of an organization that needs one; re-read organizations_forUser"],
  ["LAST_OWNER", "this is the organization's only owner who can act; make another member an owner first"],
  ["NOT_AN_OWNER", "the user is not an owner of this organization; re-read organizations_get"],
  ["MEMBER_BANNED", "a banned member can't be made an owner; choose another member"],
  ["MEMBER_NOT_FOUND", "the user is not a member of this organization; re-read organizations_get"],
  ["ORGANIZATION_NOT_FOUND", "the organization no longer exists; re-read organizations_list"],
  ["INVITATION_NOT_PENDING", "the invitation was already accepted, declined or canceled; re-read organizations_get"],
  ["INVITATION_NOT_FOUND", "no such invitation in this organization; re-read organizations_get"],
  ["TOO_MANY_ORGANIZATION_RECORDS", "the organization is too large to change in one step; retry later or use the admin app"],
];

/** Do not reveal backend trace/context, cookies or credentials to an agent. */
export function safeCapabilityError(error: unknown) {
  const message = error instanceof Error ? error.message : "CAPABILITY_FAILED";
  const organization = ORGANIZATION_CODES.find(([code]) => message.includes(code));
  if (organization) return `${organization[0]}: ${organization[1]}`;
  return PUBLIC_CODES.find(code => message.includes(code)) ?? "CAPABILITY_FAILED: check the described input schema and current access";
}
