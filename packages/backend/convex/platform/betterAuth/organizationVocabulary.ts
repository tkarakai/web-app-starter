/** Approved organization vocabulary with unchanged persisted/wire representations. */

/** Legacy stored value: membership management, never resource sharing or co-editing. */
export const MEMBERSHIP_MANAGEMENT_EXPERIENCE = "collaborative" as const;

/** Legacy enrollment purpose; retain existing receipts and retries without a data migration. */
export const MEMBERSHIP_MANAGEMENT_ENROLLMENT_PURPOSE = "collaboration" as const;

/** Existing canonical organization roles, distinct from Better Auth's global admin role. */
export const ORG_ADMIN_MEMBERSHIP_ROLE = "org-admin" as const;
export const ORG_MEMBER_ROLE = "member" as const;

/** Legacy component refusal code; authority is app-operator, not platform administration. */
export const LEGACY_APP_OPERATOR_REQUIRED_ERROR = "NOT_PLATFORM_ADMIN" as const;

export type OrganizationExperience = "personal" | typeof MEMBERSHIP_MANAGEMENT_EXPERIENCE;
export type OrganizationEnrollmentPurpose = typeof MEMBERSHIP_MANAGEMENT_ENROLLMENT_PURPOSE | "promotion" | "invitation";
