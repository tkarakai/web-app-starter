import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchAuthMutation } from "@web-app-starter/auth/server";
import { isSessionCookie, AUTH_COOKIE_PREFIX, SESSION_COOKIE_SUFFIXES } from "@web-app-starter/auth/cookies";
import { validateAuthorization } from "@web-app-starter/agentic/oauth";
import { api } from "@repo/backend";
import { agentConfig, allowedRequest, privateJson } from "@/lib/agentic/config";
import { agentRateLimit } from "@/lib/agentic/rate-limit";

/** Finish one authorization request and clear its browser credentials before returning to pi. */
export async function POST(request: Request) {
  const config = agentConfig();
  if (!config) return new Response(null, { status: 404 });
  if (!allowedRequest(request, config.authorizationOrigin)) return privateJson({ error: "invalid_origin" }, 403);
  const limited = agentRateLimit(); if (limited) return limited;
  let input;
  let decision;
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new Error("Request too large");
    const body = JSON.parse(raw) as { decision?: unknown; request?: Record<string, unknown> };
    decision = body.decision;
    if (decision !== "approve" && decision !== "deny") throw new Error("Invalid decision");
    if (!body.request || Object.values(body.request).some(value => typeof value !== "string")) throw new Error("Invalid request");
    const r = body.request as Record<string, string>;
    input = validateAuthorization(new URLSearchParams({ client_id: r.clientId, response_type: "code", redirect_uri: r.redirectUri,
      resource: r.resource, scope: r.scope, state: r.state, code_challenge_method: "S256", code_challenge: r.challenge }));
    if (r.resource !== config.resource) throw new Error("Wrong resource");
  } catch { return privateJson({ error: "invalid_request" }, 400); }
  const callback = new URL(input.redirectUri);
  callback.searchParams.set("state", input.state);
  try {
    if (decision === "approve") {
      const { clientId, redirectUri, challenge, scope } = input;
      const { code } = await fetchAuthMutation(api.platform.agentAccess.authorize, { clientId, redirectUri, challenge, scope, resource: config.resource });
      callback.searchParams.set("code", code);
    } else {
      await fetchAuthMutation(api.platform.agentAccess.deny, {});
      callback.searchParams.set("error", "access_denied");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // A denial with an already expired/deleted login has no authentication left to consume.
    if (decision === "deny" && message.includes("NOT_AUTHENTICATED")) callback.searchParams.set("error", "access_denied");
    else return privateJson({ error: message.includes("RECENT_AUTHENTICATION_REQUIRED") ? "recent_authentication_required" : message.includes("MCP_DISABLED") ? "mcp_disabled" : "decision_failed" }, 403);
  }
  const response = NextResponse.json({ redirect: callback.href }, { headers: { "Cache-Control": "no-store" } });
  const names = new Set((await cookies()).getAll().map(cookie => cookie.name));
  for (const suffix of SESSION_COOKIE_SUFFIXES) { names.add(`${AUTH_COOKIE_PREFIX}.${suffix}`); names.add(`__Secure-${AUTH_COOKIE_PREFIX}.${suffix}`); }
  for (const name of names) if (isSessionCookie(name)) response.cookies.set({ name, value: "", path: "/", maxAge: 0, expires: new Date(0), httpOnly: true, sameSite: "lax", secure: name.startsWith("__Secure-") });
  return response;
}
