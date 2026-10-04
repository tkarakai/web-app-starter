import type { GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { bearer } from "better-auth/plugins/bearer";
import type { FunctionReference } from "convex/server";

import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { sendAuthEmail } from "./sendAuthEmail";
import { sha256Hex } from "./tokenHash";

// Read-only polling/key discovery must not consume a login/send budget.
const UNLIMITED_READS = new Set(["/get-session", "/convex/token", "/jwks", "/convex/jwks", "/convex/.well-known/openid-configuration", "/ok", "/error"]);
export function normalizeAuthRecipient(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const email = value.trim().toLowerCase();
  return email && email.length <= 254 ? email : undefined;
}

export function isAuthRequestLimited(path: string, method: string): boolean {
  return method !== "OPTIONS" && !(method === "GET" && UNLIMITED_READS.has(path));
}

/** Only an explicitly verified ingress header may select an IP bucket. */
export function trustedAuthIp(request: Request): string | undefined {
  const header = process.env.AUTH_TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (!header || !/^[a-z0-9-]+$/.test(header)) return;
  const value = request.headers.get(header)?.trim();
  // Require an ingress-overwritten single address; never trust the first item of a client chain.
  if (!value || value.length > 64 || !/^[a-fA-F0-9:.]+$/.test(value)) return;
  try {
    const host = value.includes(":") ? `[${value}]` : value;
    return new URL(`http://${host}`).hostname;
  } catch {
    return;
  }
}

function retrySeconds(retryAt?: number): string {
  return String(Math.max(1, Math.ceil(((retryAt ?? Date.now() + 1000) - Date.now()) / 1000)));
}

const OTP_SEND_PATHS = new Set([
  "/two-factor/send-otp", "/email-otp/send-verification-otp",
  "/email-otp/request-password-reset", "/forget-password/email-otp",
  "/email-otp/request-email-change",
]);

const otpAdapter = components.betterAuth.adapter as typeof components.betterAuth.adapter & {
  reuseOtp: FunctionReference<"mutation", "public", {
    identifier: string; value: string; expiresAt: number; allowedAttempts: number;
  }, { id: string; identifier: string; value: string; expiresAt: number; createdAt: number; updatedAt: number }>;
};

type OtpDelivery = { recipient: string; code: () => string | undefined };
const bearerSessionHook = bearer().hooks.before[0];

export const convexRateLimitPlugin = (convexCtx: GenericCtx<DataModel>): BetterAuthPlugin => ({
  id: "convex-rate-limit",
  async onRequest(request) {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
    if (!isAuthRequestLimited(path, request.method)) return;
    let email: string | undefined;
    try {
      const body: unknown = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/x-www-form-urlencoded"
        ? Object.fromEntries(new URLSearchParams(await request.clone().text()))
        : await request.clone().json();
      email = normalizeAuthRecipient(body && typeof body === "object" && "email" in body ? body.email : undefined);
    } catch {
      // Unreadable bodies still consume deployment and any trusted-IP request budgets.
    }
    const ip = trustedAuthIp(request);
    const result = await requireActionCtx(convexCtx).runMutation(
      internal.platform.rateLimits.consumeAuthRequestBudget,
      { path, recipientKey: email ? sha256Hex(email) : undefined, ipKey: ip ? sha256Hex(ip) : undefined },
    );
    if (!result.ok) return {
      response: new Response(JSON.stringify({ error: { message: "Too many requests. Please try again later." } }), {
        status: 429, headers: { "Content-Type": "application/json", "Retry-After": retrySeconds(result.retryAt), "Cache-Control": "no-store" },
      }),
    };
  },
  hooks: { before: [{
    matcher: context => OTP_SEND_PATHS.has(context.path ?? ""),
    handler: createAuthMiddleware(async context => {
      const twoFactor = context.path === "/two-factor/send-otp";
      const changeEmail = context.path === "/email-otp/request-email-change";
      const options = context.context.getPlugin(twoFactor ? "two-factor" : "email-otp")?.options as {
        allowedAttempts?: number; otpOptions?: { allowedAttempts?: number };
        disableSignUp?: boolean; changeEmail?: { enabled?: boolean };
      } | undefined;
      const allowedAttempts = twoFactor ? options?.otpOptions?.allowedAttempts || 5 : options?.allowedAttempts || 3;
      let recipient = normalizeAuthRecipient(context.path === "/email-otp/request-email-change" ? context.body?.newEmail : context.body?.email);
      if (twoFactor) {
        // Before-hook header returns are merged only after all hooks finish.
        // Use the same bearer conversion as Convex before resolving this session.
        const bearerContext = await bearerSessionHook.handler({ ...context, returnHeaders: false });
        const session = await getSessionFromCtx({
          ...context, headers: bearerContext?.context.headers ?? context.headers,
        });
        if (session) recipient = normalizeAuthRecipient(session.user.email);
        else {
          const cookie = context.context.createAuthCookie("two_factor");
          const key = await context.getSignedCookie(cookie.name, context.context.secret);
          const challenge = key ? await context.context.internalAdapter.findVerificationValue(key) : null;
          const user = challenge ? await context.context.internalAdapter.findUserById(challenge.value) : null;
          recipient = normalizeAuthRecipient(user?.email);
        }
      }
      if (!recipient) return;
      if (!twoFactor) {
        // Match the installed endpoint's delivery eligibility before spending shared capacity.
        // The endpoint still owns validation and its non-enumerating response.
        if (changeEmail) {
          if (!options?.changeEmail?.enabled) return;
          if (await context.context.internalAdapter.findUserByEmail(recipient)) return;
        } else {
          const rawEmail = typeof context.body?.email === "string" ? context.body.email.toLowerCase() : "";
          const sendRoute = context.path === "/email-otp/send-verification-otp";
          const signup = sendRoute && context.body?.type === "sign-in" && !options?.disableSignUp;
          if (!signup && !await context.context.internalAdapter.findUserByEmail(rawEmail)) return;
        }
      }
      let code: string | undefined;
      let creationFailure: unknown;
      const delivery: OtpDelivery = { recipient, code: () => code };
      const adapter = context.context.internalAdapter;
      return { context: { context: {
        authOtpDelivery: delivery,
        internalAdapter: {
          ...adapter,
          createVerificationValue: async (data: Parameters<typeof adapter.createVerificationValue>[0]) => {
            if (!/^(2fa|email-verification|sign-in|forget-password|change-email)-otp-/.test(data.identifier)
              || (changeEmail && !data.identifier.startsWith("change-email-otp-"))) {
              return adapter.createVerificationValue(data);
            }
            try {
              // The endpoint has now validated the request/session/proofs, but has not
              // changed its challenge. Reserve before the atomic reuse/replacement.
              await reserveAuthEmail(convexCtx, recipient);
              const record = await requireActionCtx(convexCtx).runMutation(otpAdapter.reuseOtp, {
                identifier: data.identifier, value: data.value, expiresAt: data.expiresAt.getTime(), allowedAttempts,
              });
              code = record.value.split(":")[0];
              return { ...record, expiresAt: new Date(record.expiresAt), createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
            } catch (error) {
              creationFailure = error;
              throw error;
            }
          },
          deleteVerificationByIdentifier: async (identifier: string) => {
            // Email OTP retries creation by deleting the old row after any creation error.
            // A denied reservation or failed transaction must preserve the delivered proof.
            if (creationFailure) throw creationFailure;
            return adapter.deleteVerificationByIdentifier(identifier);
          },
        },
      } } };
    }),
  }] },
});

/** Delivery budget is independent of route names, client headers and session transport. */
export async function sendLimitedAuthEmail(ctx: GenericCtx<DataModel>, options: Parameters<typeof sendAuthEmail>[0]): Promise<void> {
  const recipient = normalizeAuthRecipient(options.to);
  if (!recipient) throw new Error("INVALID_EMAIL_RECIPIENT");
  await reserveAuthEmail(ctx, recipient);
  await sendAuthEmail({ ...options, to: recipient });
}

async function reserveAuthEmail(ctx: GenericCtx<DataModel>, recipient: string): Promise<void> {
  const reservation = await requireActionCtx(ctx).runMutation(internal.platform.rateLimits.reserveAuthEmail, {
    recipientKey: sha256Hex(recipient),
  });
  if (!reservation.ok) {
    // Bounded deployment-wide signal; never include addresses, tokens or message content.
    if (reservation.alert) console.warn("AUTH_EMAIL_BUDGET_EXHAUSTED", { budget: reservation.budget });
    throw new APIError("TOO_MANY_REQUESTS", { message: "Too many requests. Please try again later." }, {
      "Retry-After": retrySeconds(reservation.retryAt), "Cache-Control": "no-store",
    });
  }
}

export async function sendAuthOtp(email: string, endpoint?: { context: unknown }): Promise<void> {
  const delivery = (endpoint?.context as { authOtpDelivery?: OtpDelivery } | undefined)?.authOtpDelivery;
  if (!delivery) throw new Error("AUTH_OTP_RESERVATION_REQUIRED");
  if (delivery.recipient !== normalizeAuthRecipient(email)) throw new Error("INVALID_EMAIL_RECIPIENT");
  const code = delivery.code();
  if (!code) throw new Error("AUTH_OTP_CHALLENGE_REQUIRED");
  await sendAuthEmail({ to: delivery.recipient, type: "email-otp", urlOrCode: code });
}
