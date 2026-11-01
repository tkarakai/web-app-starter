/** Friendly English messages for organization support-action errors. */
const MESSAGES: Record<string, string> = {
  OWNER_SUCCESSOR_REQUIRED: "An organization would be left without an owner who can act. Make another member an owner first, or unban one of its owners.",
  INVALID_SUCCESSOR: "The chosen owners no longer match the organizations that need one. Reopen the dialog and choose again.",
  MEMBER_IS_ADMINISTRATOR: "A platform administrator can't be made an organization owner.",
  LAST_OWNER: "Every organization needs an owner who isn't banned. Make another member an owner first.",
  ORGANIZATION_OWNER_REQUIRED: "Every organization needs an owner who isn't banned. Make another member an owner first.",
  MEMBER_BANNED: "A banned member can't be made an owner.",
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
