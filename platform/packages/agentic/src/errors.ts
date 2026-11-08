/** Read a public code without trusting backend trace text or requiring an Error prototype. */
export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { data, message } = error as { data?: unknown; message?: unknown };
  if (data && typeof data === "object") {
    const value = data as Record<string, unknown>;
    if (typeof value.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(value.code)) return value.code;
    if (value.kind === "RateLimited") return "RATE_LIMITED";
  }
  if (typeof message !== "string") return undefined;
  // Legacy development errors may include a Convex prefix and a stack. Match whole tokens.
  return message.match(/(?<![A-Za-z0-9_])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?![A-Za-z0-9_])/)?.[1]
    ?? (/^[A-Z][A-Z0-9_]*$/.test(message) ? message : undefined);
}

/** Public error codes an agent may see. Anything else is reported generically. */
const PUBLIC_CODES = ["RECENT_AUTHENTICATION_REQUIRED", "INVALID_AGENT_TOKEN", "UNKNOWN_CAPABILITY", "WRITE_OUTPUT_CANNOT_BE_REPLAYED", "INVALID_RESULT_OFFSET", "ANNOUNCEMENT_NOT_FOUND", "NAME_REQUIRED", "BANNER_TEXT_REQUIRED", "INVALID_SCHEDULE", "NOT_ADMIN", "RATE_LIMITED", "SURFACE_DISABLED", "PROTECTED_ADMIN", "USER_NOT_FOUND", "INVALID_PAGE_SIZE", "BATCH_TOO_LARGE", "SESSION_NOT_FOUND", "GRANT_NOT_FOUND", "PASSKEY_NOT_FOUND", "CONTROL_UNAVAILABLE", "INVALID_ADMIN_PATH", "FIELD_NOT_EDITABLE", "INVALID_SELECT_OPTION", "NOT_TOGGLE", "INVALID_INPUT", "INVALID_KEY", "INVALID_VALUE", "TASK_LIMIT_REACHED", "TASK_MESSAGE_LIMIT", "MESSAGE_ID_REUSED", "CONTEXT_MISMATCH", "TASK_NOT_CONTINUABLE", "CANNOT_BAN_SELF", "CANNOT_DELETE_SELF", "INVALID_BAN", "INVALID_PROFILE", "TOO_MANY_SESSIONS", "TOO_MANY_USER_RECORDS"];

/**
 * Organization refusals, each with the step that resolves it. Only the code and this fixed
 * hint are returned: the backend message names organizations, which an agent must not be fed.
 * Only exact codes are matched.
 */
const ORGANIZATION_CODES: [code: string, recovery: string][] = [
  ["BILLING_OWNER_REQUIRED", "make another member an owner of the billing organization before deleting this user"],
  ["INVALID_PASSKEY_NAME", "provide a non-empty passkey name of at most 100 characters"],
  ["TENANCY_CHECK_CHANGED", "the install changed during its check; run the tenancy check again"],
  ["BILLING_ORGANIZATION_IN_USE", "move the paid organizations to another payer before deleting this billing organization"],
  ["CLEANUP_NOT_FOUND", "re-read organizations_cleanups; no cleanup is recorded"],
  ["CLEANUP_NOT_FAILED", "re-read organizations_cleanups; retry only a failed or stalled cleanup"],
  ["INPUT_TOO_LARGE", "reduce the request size and retry"],
  ["TASK_NOT_CANCELABLE", "read the task state; a completed task cannot be canceled"],
  ["ACCOUNT_ALREADY_EXISTS", "use the existing account instead of inviting it again"],
  ["INVALID_LOCALE", "choose a supported locale"],
  ["INVALID_THEME", "choose a supported theme"],
  ["INVALID_AVATAR_COLOR", "choose a supported avatar color"],
  ["ANNOUNCEMENT_ARCHIVED", "create a new announcement instead of publishing an archived one"],
  ["ANNOUNCEMENT_NOT_LIVE", "re-read the announcement status"],
  ["PUBLISH_NOW_NOT_ALLOWED", "review the announcement schedule and status before publishing"],
  ["CTA_URL_INVALID", "use an http or https CTA URL"],
  ["CTA_URL_REQUIRED", "provide a CTA URL"],
  ["CTA_NAME_REQUIRED", "provide a CTA label"],
  ["LEARN_MORE_CONTENT_REQUIRED", "provide the Learn More HTML content"],
  ["INVALID_SETTING_KEY", "use a supported setting key"],
  ["TENANCY_USER_REQUIRED", "re-read the current state and correct the prerequisite before retrying"],
  ["MEMBERSHIP_LIMIT_REACHED", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_SETUP_NOT_FAILED", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_SETUP_OWNERS_FIXED", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_ALREADY_CONFIGURED", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_SETUP_RUNNING", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_CHECK_REQUIRED", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_CHECK_EXPIRED", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_INSTALL_TOO_LARGE", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_PLANS_REQUIRED", "re-read the current state and correct the prerequisite before retrying"],
  ["TENANCY_INDIVIDUALS_NOT_ALLOWED", "re-read the current state and correct the prerequisite before retrying"],
  ["ORGANIZATION_NAME_REQUIRED", "re-read the current state and correct the prerequisite before retrying"],
  ["NOT_APPLICATION_USER", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_DELETION_ALREADY_SCHEDULED", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_CLEANUP_PENDING", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_DELETION_NOT_FOUND", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_DELETION_NOT_STALE", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_CLEANUP_NOT_FOUND", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_STILL_EXISTS", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_CLEANUP_RUNNING", "re-read the current state and correct the prerequisite before retrying"],
  ["PLAN_NOT_AVAILABLE", "re-read the current state and correct the prerequisite before retrying"],
  ["USER_DELETION_SCHEDULED", "re-read the current state and correct the prerequisite before retrying"],
  ["NO_PLAN_CHOICE", "re-read the current state and correct the prerequisite before retrying"],
  ["PAYMENT_METHOD_REQUIRED", "re-read the current state and correct the prerequisite before retrying"],
  ["NOT_ALLOWED", "re-read the current state and correct the prerequisite before retrying"],
  ["PAYER_REQUIRED", "re-read the current state and correct the prerequisite before retrying"],
  ["ORGANIZATION_HAS_PAYER", "re-read the current state and correct the prerequisite before retrying"],
  ["PLAN_NOT_PAID", "re-read the current state and correct the prerequisite before retrying"],
  ["ORGANIZATION_CREATION_DISABLED", "re-read the current state and correct the prerequisite before retrying"],

  ["INVALID_SCHEDULESTART", "provide a valid schedule start date"],
  ["INVALID_SCHEDULEEND", "provide a valid schedule end date"],
  ["INVALID_SCHEDULE_WINDOW", "set the end after the start"],
  ["OWNER_SUCCESSOR_REQUIRED", "an organization would be left without an owner who can act; read organizations_forUser for banSuccessor candidates and pass successors"],
  ["ORGANIZATION_OWNER_REQUIRED", "the change would leave members without an owner who can act; make another member an owner first"],
  ["INVALID_SUCCESSOR", "each successor must be a current member, not the user being changed, of an organization that needs one; re-read organizations_forUser"],
  ["LAST_OWNER", "this is the organization's only owner who can act; make another member an owner first"],
  ["NOT_AN_OWNER", "the user is not an owner of this organization; re-read organizations_get"],
  ["MEMBER_BANNED", "a banned member can't be made an owner; choose another member"],
  ["MEMBER_IS_ADMINISTRATOR", "a platform administrator can't be made an owner; choose another member"],
  ["MEMBER_NOT_FOUND", "the user is not a member of this organization; re-read organizations_get"],
  ["ORGANIZATION_NOT_FOUND", "the organization no longer exists; re-read organizations_list"],
  ["INVITATION_NOT_PENDING", "the invitation was already accepted, declined or canceled; re-read organizations_get"],
  ["INVITATION_NOT_FOUND", "no such invitation in this organization; re-read organizations_get"],
  ["TOO_MANY_ORGANIZATION_RECORDS", "the organization is too large to change in one step; retry later or use the admin app"],
];

/** Do not reveal backend trace/context, cookies or credentials to an agent. */
export function safeCapabilityError(error: unknown) {
  const code = errorCode(error);
  const organization = ORGANIZATION_CODES.find(([value]) => code === value);
  if (organization) return `${organization[0]}: ${organization[1]}`;
  return code && PUBLIC_CODES.includes(code) ? code : "CAPABILITY_FAILED: check the described input schema and current access";
}
