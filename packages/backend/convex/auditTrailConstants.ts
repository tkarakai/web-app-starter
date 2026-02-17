export const AUDIT_ACTIONS = [
  "auth.sign_in",
  "auth.sign_in_failed",
  "auth.sign_out",
  "auth.sign_up",
  "auth.password_reset_requested",
  "auth.password_reset_completed",
  "auth.email_verified",
  "auth.two_factor_enabled",
  "auth.two_factor_disabled",
  "user.profile_updated",
  "user.name_changed",
  "user.avatar_changed",
  "admin.user_banned",
  "admin.user_unbanned",
  "admin.user_deleted",
  "admin.role_changed",
  "admin.mfa_policy_changed",
  "admin.waitlist_setting_changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
