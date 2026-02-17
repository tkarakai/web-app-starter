// ---------------------------------------------------------------------------
// Audit Trail Enums
//
// All enums use hierarchical dot notation. Dots separate hierarchy levels,
// underscores separate words within a level.
//
// Actions describe WHAT happened (never the outcome).
// Statuses describe THE OUTCOME (never the action).
//
// These enums are runtime-enforced by the audit trail. Adding a new value
// here is all that's needed — old values in the database are unaffected.
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  // auth.*
  "auth.sign_in",
  "auth.sign_out",
  "auth.sign_up",
  "auth.password_reset.requested",
  "auth.password_reset.completed",
  "auth.email_verified",
  "auth.two_factor.enabled",
  "auth.two_factor.disabled",

  // user.*
  "user.profile_updated",
  "user.name_changed",
  "user.avatar_changed",

  // admin.*
  "admin.user.banned",
  "admin.user.unbanned",
  "admin.user.deleted",
  "admin.role_changed",
  "admin.mfa_policy_changed",
  "admin.waitlist_setting_changed",

  // waitlist.*
  "waitlist.joined",
  "waitlist.invitation.sent",
  "waitlist.invitation.revoked",
  "waitlist.entry.deleted",

  // waitlist.token.*
  "waitlist.token.claimed",
  "waitlist.token.released",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_STATUSES = [
  // success
  "succeeded",

  // failed.*
  "failed.wrong_password",
  "failed.invalid_period",
  "failed.not_found",
  "failed.unauthorized",
  "failed.validation_error",
  "failed.rate_limited",
  "failed.internal_error",
  "failed.expired",
  "failed.already_used",
  "failed.blocked",
] as const;

export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_SOURCE_TRANSPORTS = ["web", "server"] as const;

export type AuditSourceTransport = (typeof AUDIT_SOURCE_TRANSPORTS)[number];
