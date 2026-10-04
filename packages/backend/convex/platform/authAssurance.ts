import type { GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { bearer } from "better-auth/plugins/bearer";
import { parseSessionOutput } from "better-auth/db";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import type { Doc } from "./betterAuth/_generated/dataModel";
import { emailLoginEnabled, evaluateSession, readPolicies, readSession, type AuthSession } from "./sessionPolicy";
import { ADMIN_SESSION_MS, RECENT_AUTH_MS, sessionFields } from "./sessionFields";

type Endpoint = Parameters<typeof getSessionFromCtx>[0];
const bearerHook = bearer().hooks.before[0];
const PUBLIC = new Set([
  "/ok", "/error", "/sign-in/email", "/sign-up/email", "/sign-out", "/get-session",
  "/request-password-reset", "/reset-password", "/reset-password/:token", "/verify-email", "/send-verification-email",
  "/email-otp/request-password-reset", "/forget-password/email-otp", "/email-otp/reset-password",
  "/email-otp/send-verification-otp", "/email-otp/check-verification-otp", "/email-otp/verify-email",
  "/convex/token", "/convex/jwks", "/convex/.well-known/openid-configuration",
  "/passkey/generate-authenticate-options", "/passkey/verify-authentication", "/sign-in/magic-link", "/magic-link/verify",
]);
const SELF = new Set(["/verify-password", "/passkey/list-user-passkeys", "/revoke-session", "/revoke-other-sessions", "/revoke-sessions"]);
const FACTOR = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/send-otp", "/two-factor/verify-otp"]);
const ENROLL = new Set(["/two-factor/enable", "/passkey/generate-register-options", "/passkey/verify-registration"]);
const SENSITIVE = new Set([
  "/list-sessions", // Better Auth returns reusable tokens: never expose stronger sessions to a limited one.
  "/change-password", "/change-email", "/delete-user", "/delete-user/callback", "/update-user", "/update-session",
  "/two-factor/disable", "/two-factor/get-totp-uri", "/two-factor/generate-backup-codes",
  "/passkey/delete-passkey", "/passkey/update-passkey", "/email-otp/request-email-change", "/email-otp/change-email",
]);
const PASSWORD_PROOF = new Set(["/verify-password", "/change-password", "/delete-user", "/two-factor/enable", "/two-factor/disable", "/two-factor/get-totp-uri", "/two-factor/generate-backup-codes"]);
// These methods have no supported platform flow. Installing a plugin is not authorization.
const DISABLED = new Set([
  "/sign-in/email-otp", "/sign-in/social", "/callback/:id", "/link-social", "/unlink-account",
  "/refresh-token", "/get-access-token", "/account-info", "/list-accounts",
  "/admin/impersonate-user", "/admin/stop-impersonating",
]);
export function authRoutePolicy(path: string): "public" | "self" | "factor" | "enroll" | "sensitive" | "admin" | "disabled" {
  if (DISABLED.has(path)) return "disabled";
  if (PUBLIC.has(path) || /^\/reset-password\/[^/]+$/.test(path)) return "public";
  if (SELF.has(path)) return "self";
  if (FACTOR.has(path)) return "factor";
  if (ENROLL.has(path)) return "enroll";
  if (SENSITIVE.has(path)) return "sensitive";
  if (path.startsWith("/admin/")) return "admin";
  return "disabled";
}

function refuse(code: string): never {
  throw new APIError("FORBIDDEN", { code, message: code });
}

/** A factory per authentication request: verified evidence never escapes that request. */
export function createAssuranceHooks(convexCtx: GenericCtx<DataModel>) {
  let factorBefore: { id: string; userId: string; kind: "totp" | "passkey" } | undefined;
  let passwordBefore: string | undefined;
  let passkeyVerified = false;
  let rotationSource: AuthSession | null = null;
  const actionCtx = () => requireActionCtx(convexCtx);

  async function endpointSession(endpoint: Endpoint): Promise<AuthSession | null> {
    // Convex's bearer conversion normally runs later in the before-hook chain.
    const converted = await bearerHook.handler({ ...endpoint, returnHeaders: false });
    const pair = await getSessionFromCtx({ ...endpoint, headers: converted?.context.headers ?? endpoint.headers });
    return pair ? readSession(convexCtx, pair.user.id, pair.session.id) : null;
  }

  const before = createAuthMiddleware(async endpoint => {
    const path = endpoint.path ?? "";
    const policy = authRoutePolicy(path);
    if (policy === "disabled") refuse("AUTH_METHOD_DISABLED");
    if ((path === "/sign-in/magic-link" || path === "/magic-link/verify") && !await emailLoginEnabled(convexCtx)) refuse("AUTH_METHOD_DISABLED");
    if ((path === "/email-otp/send-verification-otp" || path === "/email-otp/check-verification-otp") && endpoint.body?.type === "sign-in") refuse("AUTH_METHOD_DISABLED");
    if (path === "/sign-in/magic-link" && typeof endpoint.body?.email === "string") {
      const user = await actionCtx().runQuery(components.betterAuth.adapter.findOne, {
        model: "user", where: [{ field: "email", value: endpoint.body.email.trim().toLowerCase() }],
      }) as Doc<"user"> | null;
      if (user && (await readPolicies(convexCtx, user)).scope === "admin") return endpoint.json({ status: true });
    }
    const pair = await endpointSession(endpoint);
    if (["/change-password", "/two-factor/disable", "/two-factor/enable", "/two-factor/verify-totp"].includes(path)) rotationSource = pair;
    if (path === "/passkey/verify-authentication") {
      const id = endpoint.body?.response?.id;
      if (typeof id === "string") {
        const key = await actionCtx().runQuery(components.betterAuth.adapter.findOne, { model: "passkey", where: [{ field: "credentialID", value: id }] });
        if (key) factorBefore = { id: key._id, userId: key.userId, kind: "passkey" };
      }
    }
    if (FACTOR.has(path)) {
      if (endpoint.context.session && !pair) refuse("NOT_AUTHENTICATED");
      let userId = pair?.user._id;
      if (!userId) {
        const cookie = endpoint.context.createAuthCookie("two_factor");
        const token = await endpoint.getSignedCookie(cookie.name, endpoint.context.secret);
        const challenge = token ? await endpoint.context.internalAdapter.findVerificationValue(token) : null;
        if (challenge && new Date(challenge.expiresAt).getTime() > Date.now()) userId = challenge.value as typeof userId;
      }
      if (userId) {
        const factor = await actionCtx().runQuery(components.betterAuth.adapter.findOne, { model: "twoFactor", where: [{ field: "userId", value: userId }] });
        if (factor) factorBefore = { id: factor._id, userId, kind: "totp" };
        if (path !== "/two-factor/send-otp") {
          const limit = await actionCtx().runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "authStepUp", key: userId });
          if (!limit.ok) throw new APIError("TOO_MANY_REQUESTS", { code: "RATE_LIMITED", message: "Too many verification attempts." });
        }
      }
      // Pending password challenges have no session yet. The factor plugin validates them.
      if (!pair) return;
    }
    if (policy === "public") {
      // Token/session introspection remains available to limited sessions for enrollment.
      if ((path === "/convex/token" || path === "/get-session") && endpoint.context.session && !pair) refuse("NOT_AUTHENTICATED");
      return;
    }
    if (!pair) refuse("NOT_AUTHENTICATED");
    const assurance = await evaluateSession(convexCtx, pair);
    if (PASSWORD_PROOF.has(path)) {
      const limit = await actionCtx().runMutation(internal.platform.rateLimits.consumeAuthRateLimit, { name: "authStepUp", key: pair.user._id });
      if (!limit.ok) throw new APIError("TOO_MANY_REQUESTS", { code: "RATE_LIMITED", message: "Too many verification attempts." });
    }
    if (path === "/verify-password") {
      const account = await actionCtx().runQuery(components.betterAuth.adapter.findOne, { model: "account", where: [{ field: "userId", value: pair.user._id }, { field: "providerId", value: "credential" }] });
      passwordBefore = account?.password ?? undefined;
    }
    if (policy === "self" || policy === "factor") return;
    if (policy === "enroll") {
      if (assurance.reason === "email_verification" || assurance.reason === "method_disabled" || assurance.reason === "reauthenticate") refuse("REAUTHENTICATION_REQUIRED");
      if (path.startsWith("/passkey/") && assurance.passkeyPolicy === "disabled") refuse("AUTH_METHOD_DISABLED");
      // Lost-factor recovery may replace TOTP only; the endpoint also verifies the current password.
      if (assurance.reason === "recovery" && path === "/two-factor/enable") return;
      if (assurance.reason === "recovery") refuse("RECOVERY_REQUIRED");
      if (assurance.hasTotp || (assurance.hasPasskey && assurance.passkeyPolicy !== "disabled")) {
        if (!assurance.strong || !assurance.recent) refuse("RECENT_AUTHENTICATION_REQUIRED");
      } else if (!pair.session.primaryVerifiedAt || pair.session.primaryVerifiedAt + RECENT_AUTH_MS <= Date.now()) refuse("RECENT_AUTHENTICATION_REQUIRED");
      return;
    }
    if (!assurance.allowed) refuse("SECURITY_ENROLLMENT_REQUIRED");
    if (policy === "admin" && assurance.scope !== "admin") refuse("NOT_ADMIN");
    if (!assurance.recent) refuse("RECENT_AUTHENTICATION_REQUIRED");
  });

  const after = createAuthMiddleware(async endpoint => {
    if (endpoint.context.returned instanceof APIError) return;
    const path = endpoint.path ?? "";
    if (path === "/passkey/generate-authenticate-options") {
      return endpoint.json({ ...(endpoint.context.returned as Record<string, unknown>), userVerification: "required" });
    }
    let kind: "password" | "totp" | "passkey" | "recovery" | undefined;
    if (path === "/verify-password" && passwordBefore) kind = "password";
    if (path === "/two-factor/verify-totp" && factorBefore) kind = "totp";
    if (path === "/two-factor/verify-backup-code") kind = "recovery";
    if (path === "/passkey/verify-authentication" && passkeyVerified && factorBefore) kind = "passkey";
    if (!kind) return;
    const pair = endpoint.context.newSession ?? endpoint.context.session;
    if (!pair || (factorBefore && factorBefore.userId !== pair.user.id)) refuse("NOT_AUTHENTICATED");
    await actionCtx().runMutation(internal.platform.sessionAssurance.recordProof, {
      userId: pair.user.id, sessionId: pair.session.id, kind,
      ...(kind === "password" ? { passwordHash: passwordBefore } : {}),
      ...(kind === "totp" || kind === "passkey" ? { factorId: factorBefore!.id } : {}),
    });
    if (path === "/passkey/verify-authentication") {
      const output = endpoint.context.returned as { session: typeof pair.session };
      return endpoint.json({ ...output, session: parseSessionOutput(endpoint.context.options, output.session) });
    }
  });

  type CreateHook = NonNullable<NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>["create"]>["before"];
  const beforeCreate: CreateHook = async (session, endpoint) => {
    const path = endpoint?.path ?? "";
    let data: Record<string, unknown>;
    const existing = endpoint?.context.session;
    if (existing?.user.id === session.userId && ["/change-password", "/two-factor/disable", "/two-factor/enable", "/two-factor/verify-totp"].includes(path)) {
      // Better Auth deletes the original session before password-change rotation.
      // Preserve only proof captured by this request's live-session check, never
      // the client body or the newly allocated session creation time.
      const old = await readSession(convexCtx, session.userId, existing.session.id)
        ?? (rotationSource?.session._id === existing.session.id && rotationSource.user._id === session.userId ? rotationSource : null);
      if (!old) refuse("NOT_AUTHENTICATED");
      data = Object.fromEntries(Object.keys(sessionFields).map(key => [key, old.session[key as keyof typeof old.session]]));
    } else {
      const method = ["/sign-in/email", "/sign-up/email", "/two-factor/verify-totp", "/two-factor/verify-otp", "/two-factor/verify-backup-code"].includes(path)
        ? "password" : path === "/magic-link/verify" ? "magic-link" : path === "/passkey/verify-authentication" && passkeyVerified ? "passkey" : "unknown";
      data = { assuranceVersion: 1, authMethod: method, authenticatedAt: Date.now(), primaryVerifiedAt: method === "unknown" ? 0 : Date.now(), strongVerifiedAt: 0, strongFactorId: "", strongFactorType: "", recoveryOnly: path === "/two-factor/verify-backup-code" };
    }
    const user = await actionCtx().runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: session.userId }] }) as Doc<"user"> | null;
    if (!user || user.banned) refuse("NOT_AUTHENTICATED");
    const policy = await readPolicies(convexCtx, user);
    if (data.authMethod === "magic-link" && (policy.scope === "admin" || !await emailLoginEnabled(convexCtx))) refuse("AUTH_METHOD_DISABLED");
    if (policy.scope === "admin") data.expiresAt = new Date(Math.min(new Date(session.expiresAt).getTime(), Number(data.authenticatedAt ?? session.createdAt) + ADMIN_SESSION_MS));
    return { data: { ...session, ...data } };
  };

  return {
    plugin: { id: "session-assurance", hooks: { before: [{ matcher: () => true, handler: before }], after: [{ matcher: () => true, handler: after }] } } satisfies BetterAuthPlugin,
    beforeCreate,
    verifyPasskey: async (userVerified: boolean) => {
      if (!userVerified || factorBefore?.kind !== "passkey") refuse("PASSKEY_USER_VERIFICATION_REQUIRED");
      const user = await actionCtx().runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: factorBefore.userId }] }) as Doc<"user"> | null;
      if (!user || user.banned || (await readPolicies(convexCtx, user)).passkeyPolicy === "disabled") refuse("AUTH_METHOD_DISABLED");
      passkeyVerified = true;
    },
  };
}
