/** Do not reveal backend trace/context, cookies or credentials to an agent. */
export function safeCapabilityError(error: unknown) {
  const message = error instanceof Error ? error.message : "CAPABILITY_FAILED";
  return ["RECENT_AUTHENTICATION_REQUIRED", "INVALID_AGENT_TOKEN", "UNKNOWN_CAPABILITY", "WRITE_OUTPUT_CANNOT_BE_REPLAYED", "INVALID_RESULT_OFFSET", "ANNOUNCEMENT_NOT_FOUND", "NAME_REQUIRED", "BANNER_TEXT_REQUIRED", "INVALID_SCHEDULE", "NOT_ADMIN", "RATE_LIMITED", "SURFACE_DISABLED", "PROTECTED_ADMIN", "USER_NOT_FOUND", "INVALID_PAGE_SIZE", "BATCH_TOO_LARGE", "SESSION_NOT_FOUND"].find(code => message.includes(code)) ?? "CAPABILITY_FAILED: check the described input schema and current access";
}
