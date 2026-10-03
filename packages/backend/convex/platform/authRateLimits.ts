import type { GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";

import { internal } from "../_generated/api";
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

export const convexRateLimitPlugin = (convexCtx: GenericCtx<DataModel>): BetterAuthPlugin => ({
  id: "convex-rate-limit",
  async onRequest(request) {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
    if (!isAuthRequestLimited(path, request.method)) return;
    let email: string | undefined;
    try {
      const body: unknown = await request.clone().json();
      email = normalizeAuthRecipient(body && typeof body === "object" && "email" in body ? body.email : undefined);
    } catch { /* Requests without a JSON email still consume the general request budget. */ }
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
});

/** Delivery budget is independent of route names, client headers and session transport. */
export async function sendLimitedAuthEmail(ctx: GenericCtx<DataModel>, options: Parameters<typeof sendAuthEmail>[0]): Promise<void> {
  const recipient = normalizeAuthRecipient(options.to);
  if (!recipient) throw new Error("INVALID_EMAIL_RECIPIENT");
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
  // No refunds or automatic retry on ambiguous provider failure: every attempt costs a token.
  await sendAuthEmail({ ...options, to: recipient });
}
