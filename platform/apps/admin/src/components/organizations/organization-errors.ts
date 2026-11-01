/** Friendly English messages for organization support-action errors. */
const MESSAGES: Record<string, string> = {
  LAST_OWNER: "Every organization needs an owner. Make another member an owner first.",
  ORGANIZATION_OWNER_REQUIRED: "Every organization needs an owner. Make another member an owner first.",
  MEMBER_NOT_FOUND: "That person is no longer a member of this organization.",
  NOT_AN_OWNER: "That member is not an owner.",
  ORGANIZATION_NOT_FOUND: "This organization no longer exists.",
  INVITATION_NOT_FOUND: "This invitation no longer exists.",
  INVITATION_NOT_PENDING: "This invitation is no longer pending.",
  RECENT_AUTHENTICATION_REQUIRED: "Confirm your identity again, then retry.",
};

export function organizationErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const code = Object.keys(MESSAGES).find((key) => text.includes(key));
  return code ? MESSAGES[code]! : "Action failed. Please try again.";
}
