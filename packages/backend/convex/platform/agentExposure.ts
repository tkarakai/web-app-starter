/** Executable exposure inventory. Selection into the native registry is a separate opt-in. */
/** Deprecated wire vocabulary; retain classification/target tokens and permission semantics. */
export const LEGACY_APP_OPERATOR_EXPOSURE = {
  control: "operator-control", identity: "operator-identity", principal: "operator",
  directory: "operator-list", emailDirectory: "operator-email-list",
} as const;
export type OperationClass = typeof LEGACY_APP_OPERATOR_EXPOSURE.control | typeof LEGACY_APP_OPERATOR_EXPOSURE.identity | "self-service" | "tenant-data" | "member-management" | "human-workflow" | "internal-denied";
export type TargetPolicy = "control" | typeof LEGACY_APP_OPERATOR_EXPOSURE.principal | typeof LEGACY_APP_OPERATOR_EXPOSURE.directory | typeof LEGACY_APP_OPERATOR_EXPOSURE.emailDirectory | "self" | "organization" | "legacy-private" | "tenant" | "denied";
export interface OperationExposure {
  operation: string;
  classification: OperationClass;
  target: TargetPolicy;
  native: boolean;
  direct: typeof LEGACY_APP_OPERATOR_EXPOSURE.principal | "self" | "tenant" | "human" | "public" | "denied";
}
const inventory: Record<string, OperationExposure> = Object.create(null);
function group(module: string, names: string[], classification: OperationClass, target: TargetPolicy, native = false, direct: OperationExposure["direct"] = classification === "internal-denied" ? "denied" : classification === "self-service" ? "self" : classification === "tenant-data" || classification === "member-management" ? "tenant" : classification === "human-workflow" ? "human" : LEGACY_APP_OPERATOR_EXPOSURE.principal) {
  for (const name of names) {
    const operation = `${module}:${name}`;
    inventory[operation] = Object.freeze({ operation, classification, target, native, direct });
  }
}
function platform(module: string, names: string[], classification: OperationClass, target: TargetPolicy, native = false, direct?: OperationExposure["direct"]) {
  group(`platform/${module}`, names, classification, target, native, direct);
}
platform("announcements", ["list", "create", "update", "publishNow", "unpublishNow", "setLive", "archive", "remove"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("appSettings", ["get", "set", "remove", "getEmailTemplate", "getVerificationEmailTemplate"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("adminAuth", ["getMfaPolicy", "setMfaPolicy", "getEmailVerificationPolicy", "setEmailVerificationPolicy", "listAdminPasskeyUserIds"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("adminInvitations", ["list", "invite", "remove"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("waitlist", ["list", "invite", "inviteMany", "uninvite", "remove"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("waitlistTokens", ["listByEntry"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("auditTrail", ["list"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("integrations", ["getStatus"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("adminEmails", ["listProtected"], LEGACY_APP_OPERATOR_EXPOSURE.identity, LEGACY_APP_OPERATOR_EXPOSURE.emailDirectory, true);
platform("agentUsers", ["list"], LEGACY_APP_OPERATOR_EXPOSURE.identity, LEGACY_APP_OPERATOR_EXPOSURE.directory, true);
platform("agentUsers", ["get", "ban", "unban", "setRole", "update", "sessions", "revokeSession", "revokeSessions"], LEGACY_APP_OPERATOR_EXPOSURE.identity, LEGACY_APP_OPERATOR_EXPOSURE.principal, true);
platform("agentUsers", ["remove"], LEGACY_APP_OPERATOR_EXPOSURE.identity, LEGACY_APP_OPERATOR_EXPOSURE.principal, false, "denied");
platform("organizations", ["list", "get", "setLifecycle"], LEGACY_APP_OPERATOR_EXPOSURE.control, "organization", true);
platform("agentTaskAdmin", ["get", "list", "cancel"], LEGACY_APP_OPERATOR_EXPOSURE.control, "self", true);
platform("agentAccess", ["listMine", "revoke"], LEGACY_APP_OPERATOR_EXPOSURE.control, "self", true);
platform("agentSurfaces", ["configuration", "setEnabled"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("userProfiles", ["get", "getLocale", "upsert", "setLocale"], "self-service", "self", true);
platform("agentRegistry", ["currentUser", "assurance", "onboardingStatus", "ownPasskeys", "renamePasskey", "removePasskey", "revokeOtherSessions"], "self-service", "self", true);
platform("agentRegistry", ["announcement"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true);
platform("agentRegistry", ["activeAnnouncement", "settingKeys"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", true, "self");
platform("agentCapabilities", ["catalogue", "read", "write", "browserRead", "browserWrite", "browserGateway", "exposure"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control");
platform("agentAccess", ["authorize", "exchange", "inspect"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control");
platform("agentAccess", ["deny"], "self-service", "self");
platform("agentTasks", ["send", "get", "list", "cancel"], LEGACY_APP_OPERATOR_EXPOSURE.control, "self");
platform("auth", ["getCurrentUser"], "self-service", "self");
platform("auth", ["viewBackupCodes"], "human-workflow", "denied");
platform("sessionAssurance", ["status"], "self-service", "self");
platform("adminInvitations", ["advanceOnboardingStep", "claimInvitation", "completeOnboarding", "getMyOnboardingStatus", "register", "validateToken"], "human-workflow", "denied");
platform("organizationEnrollment", ["begin", "status", "verifyCredential", "acknowledgeRecovery"], "human-workflow", "denied");
platform("memberInvitations", ["preview", "claim", "register", "requestVerification", "accept"], "member-management", "tenant");
platform("tenantContext", ["mine", "get"], "tenant-data", "tenant");
platform("waitlistTokens", ["beginClaim", "finalizeClaim", "releaseClaim", "validate"], "human-workflow", "denied");
platform("announcements", ["getActivePublic"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", false, "public");
platform("appSettings", ["getPublic"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", false, "public");
platform("meta", ["health"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", false, "public");
platform("passwordStrength", ["evaluate"], "human-workflow", "denied", false, "public");
platform("agentSurfaces", ["availability"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", false, "public");
platform("auditTrail", ["postEvent"], "self-service", "self");
platform("sessions", ["listSessionsHandler", "revokeSessionHandler", "revokeOtherSessionsHandler"], "self-service", "self");
platform("sessions", ["viewBackupCodesHandler"], "human-workflow", "denied");

// Legacy private APIs remain owner-only under their migration gate. They are never app-operator tools.
group("projects", ["list", "listWithStats", "get", "create", "update", "remove"], "tenant-data", "legacy-private");
group("tasks", ["listByProject", "create", "update", "remove"], "tenant-data", "legacy-private");
group("files", ["generateUploadUrl", "saveUpload", "uploadFile", "downloadFile", "listUploads", "deleteUpload"], "tenant-data", "legacy-private");
group("tenantProjects", ["list", "listWithStats", "get", "create", "update", "remove"], "tenant-data", "tenant");
group("tenantTasks", ["listByProject", "create", "update", "remove"], "tenant-data", "tenant");
group("tenantFiles", ["uploadFile", "downloadFile", "listUploads", "deleteUpload"], "tenant-data", "tenant");

// Storage, proof, scheduler and component primitives have no app-operator transport authority.
for (const [module, names] of Object.entries({
  agentAccess: ["expireCode", "expireGrant", "expireDelegation"],
  agentTasks: ["begin", "perform", "fail", "work", "expire", "recover"],
  adminInvitations: ["createForSeed", "setToken", "hasValidAdminInvitation", "registerAccount", "requiresEnrollment"],
  adminInvitationActions: ["generateTokenAndSendEmail"], adminEmails: ["list"],
  announcements: ["getActiveInternal", "handleScheduledStart", "handleScheduledEnd", "getAdminListInternal", "publishNowInternal", "unpublishNowInternal"],
  appSettings: ["getInternal"], auditTrail: ["insertEvent"],
  bootstrap: ["initialize", "rescue", "status"],
  componentMigration: ["begin", "copyBatch", "verifyPage", "status", "run", "restartTable", "deploymentStatus"],
  devSeed: ["isSeeded", "markSeeded", "setupDevUser", "finalizeDevToken", "seed"], devTotp: ["getDevTotpCode"],
  e2eFixtures: ["prepareE2eInvitation", "finalizeE2eInvitation", "createE2eUser"],
  organizationEnrollment: ["snapshot", "recordCredential", "recordRecovery"],
  memberInvitations: ["registerAccount", "recipientSnapshot"],
  recoveryCodes: ["snapshot"], sessionAssurance: ["bindRecoveryReplacement", "recordProof"],
  rateLimits: ["consumeAuthRateLimit", "consumeAuthRequestBudget", "reserveAuthEmail"],
  waitlist: ["join"], waitlistActions: ["generateTokenAndSendEmail"], waitlistTokens: ["create", "hasValidInvitation"],
})) platform(module, names, "internal-denied", "denied");
group("files", ["beginUpload", "finishUpload", "discardUnattachedUpload", "authorizeDownload", "inventoryLegacyUploads"], "internal-denied", "denied");
group("tenantFiles", ["beginUpload", "finishUpload", "authorizeDownload"], "internal-denied", "denied");

// Raw identity administration obeys the same app-operator target boundary; ceremonies are never tools.
group("auth/admin", ["list-users"], LEGACY_APP_OPERATOR_EXPOSURE.identity, LEGACY_APP_OPERATOR_EXPOSURE.directory, false, "denied");
group("auth/admin", ["get-user", "ban-user", "unban-user", "set-role", "update-user", "remove-user", "list-user-sessions", "revoke-user-session", "revoke-user-sessions"], LEGACY_APP_OPERATOR_EXPOSURE.identity, LEGACY_APP_OPERATOR_EXPOSURE.principal, false, "denied");
group("auth/admin", ["create-user", "set-user-password", "impersonate-user", "stop-impersonating"], "internal-denied", "denied");
group("auth", ["get-session", "verify-password", "list-sessions", "revoke-session", "revoke-other-sessions", "revoke-sessions", "update-user", "update-session"], "self-service", "self");
group("auth", ["sign-in/email", "sign-up/email", "sign-out", "request-password-reset", "reset-password", "change-password", "change-email", "delete-user", "two-factor/enable", "two-factor/disable", "two-factor/verify-totp", "two-factor/verify-backup-code", "two-factor/generate-backup-codes", "passkey/generate-register-options", "passkey/verify-registration", "passkey/delete-passkey", "passkey/update-passkey", "passkey/generate-authenticate-options", "passkey/verify-authentication", "passkey/list-user-passkeys"], "human-workflow", "denied");
group("auth", ["reset-password/:token", "verify-email", "send-verification-email", "email-otp/request-password-reset", "forget-password/email-otp", "email-otp/reset-password", "email-otp/send-verification-otp", "email-otp/check-verification-otp", "email-otp/verify-email", "sign-in/magic-link", "magic-link/verify", "two-factor/send-otp", "two-factor/verify-otp", "two-factor/get-totp-uri", "email-otp/request-email-change", "email-otp/change-email"], "human-workflow", "denied");
group("auth", ["ok", "error", "convex/jwks", "convex/.well-known/openid-configuration"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", false, "public");
group("auth", ["convex/token"], "self-service", "self");
group("auth", ["sign-in/email-otp", "sign-in/social", "callback/:id", "link-social", "unlink-account", "refresh-token", "get-access-token", "account-info", "list-accounts"], "internal-denied", "denied");
group("auth", ["delete-user", "delete-user/callback"], "human-workflow", "denied", false, "denied");
group("workflow", ["account_changePassword", "account_securityEnrollment", "account_reauthenticate", "account_emailVerification", "account_passwordReset", "invitations_completeEnrollment", "users_create", "account_signIn", "account_signOut"], "human-workflow", "denied", false, "denied");
group("browser", ["browser_readPage", "browser_navigate", "browser_activate", "browser_fill", "browser_select", "browser_toggle", "browser_scroll", "browser_reload"], "human-workflow", "denied", false, "denied");
group("http", ["GET /api/waitlist/status", "GET /api/announcements/active"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control", false, "public");
group("http", ["POST /api/waitlist/join"], "human-workflow", "denied", false, "public");
group("http", ["GET /api/sessions", "POST /api/sessions/revoke", "POST /api/sessions/revoke-others"], "self-service", "self");
group("http", ["GET /api/two-factor/backup-codes", "POST /api/two-factor/backup-codes"], "human-workflow", "denied");
group("http", ["GET /api/dev/totp-code", "POST /api/dev/e2e-user"], "internal-denied", "denied");
group("http", ["POST /api/mcp", "POST /api/agent/cli", "POST /api/a2a"], LEGACY_APP_OPERATOR_EXPOSURE.control, "control");

/** Unknown operations fail closed, including captured functions added through custom builders. */
export function operationExposure(operation: string): OperationExposure {
  return inventory[operation] ?? { operation, classification: "internal-denied", target: "denied", native: false, direct: "denied" };
}
export function exposureInventory(): OperationExposure[] {
  return Object.values(inventory).sort((a, b) => a.operation.localeCompare(b.operation));
}
export function authOperationExposure(path: string): OperationExposure {
  const normalized = /^\/reset-password\/[^/]+$/.test(path) ? "/reset-password/:token" : path;
  return operationExposure(normalized.startsWith("/admin/") ? `auth/admin:${normalized.slice(7)}` : `auth:${normalized.replace(/^\//, "")}`);
}
export function httpOperationExposure(method: string, path: string): OperationExposure {
  if (path.startsWith("/api/auth/")) return authOperationExposure(path.slice("/api/auth".length));
  return operationExposure(`http:${method.toUpperCase()} ${path}`);
}
