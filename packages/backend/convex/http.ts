import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// ---------------------------------------------------------------------------
// CORS helpers — dynamic origin checking
// ---------------------------------------------------------------------------

function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const siteUrl = process.env.SITE_URL ?? "http://localhost:3001";
  for (const u of siteUrl.split(",")) {
    const trimmed = u.trim();
    if (trimmed) origins.add(trimmed);
  }
  const landingUrl = process.env.LANDING_URL ?? "http://localhost:3000";
  for (const u of landingUrl.split(",")) {
    const trimmed = u.trim();
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

function corsHeaders(request?: Request): Record<string, string> {
  const allowed = getAllowedOrigins();
  const origin = request?.headers.get("Origin") ?? "";
  const allowOrigin = allowed.has(origin) ? origin : "";

  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

// ---------------------------------------------------------------------------
// GET /api/waitlist/status — check if waitlist mode is enabled
// ---------------------------------------------------------------------------

http.route({
  path: "/api/waitlist/status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const enabled = await ctx.runQuery(internal.appSettings.getInternal, {
      key: "waitlistEnabled",
    });

    return new Response(JSON.stringify({ enabled: enabled ?? false }), {
      status: 200,
      headers: corsHeaders(request),
    });
  }),
});

http.route({
  path: "/api/waitlist/status",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }),
});

// ---------------------------------------------------------------------------
// POST /api/waitlist/join — join the waitlist
// ---------------------------------------------------------------------------

http.route({
  path: "/api/waitlist/join",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const { email, meta } = body;

      // Basic input validation
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return new Response(JSON.stringify({ error: "INVALID_EMAIL" }), {
          status: 400,
          headers: corsHeaders(request),
        });
      }

      // Forward IP for rate limiting
      const clientIp =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        "unknown";

      const result = await ctx.runMutation(internal.waitlist.join, {
        email: email.trim().toLowerCase(),
        meta: typeof meta === "string" ? meta : JSON.stringify(meta ?? {}),
        clientIp,
      });

      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200,
        headers: corsHeaders(request),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
      const status = message === "WAITLIST_NOT_ENABLED" ? 400 : 500;
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: corsHeaders(request),
      });
    }
  }),
});

http.route({
  path: "/api/waitlist/join",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }),
});

export default http;
