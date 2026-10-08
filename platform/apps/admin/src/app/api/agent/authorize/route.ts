import { backendClient } from "@/lib/agentic/convex-adapter";
import { agentRateLimit } from "@/lib/agentic/rate-limit";
import { fetchAuthQuery } from "@web-app-starter/auth/server";
import { api } from "@repo/backend";
import { validateAuthorization } from "@web-app-starter/agentic/oauth";
import { agentConfig, configuredSurface, allowedRequest, privateJson } from "@/lib/agentic/config";
export async function GET(request: Request) {
  const config = agentConfig();
  if (!config) return new Response(null, { status: 404 });
  const limited = agentRateLimit(); if (limited) return limited;
  if (!allowedRequest(request, config.authorizationOrigin)) return privateJson({ error: "invalid_origin" }, 403);
  const params = new URL(request.url).searchParams;
  const surface = configuredSurface(params.get("resource"));
  if (!surface) return privateJson({ error: "invalid_request" }, 400);
  if (!(await backendClient().query(api.platform.agentSurfaces.availability, { surface })).enabled) return privateJson({ error: "surface_disabled" }, 503);
  try {
    validateAuthorization(params);
  } catch { return privateJson({ error: "invalid_request" }, 400); }
  const returnPath = `/settings/agent-access?${params.toString()}`;
  let user;
  try { user = await fetchAuthQuery(api.platform.auth.getCurrentUser, {}); } catch { user = null; }
  const status = user ? await fetchAuthQuery(api.platform.sessionAssurance.status, {}) : null;
  if (user && status?.authPurpose !== "mcp-authorization") user = null;
  if (user && user.role !== "admin") return privateJson({ error: "admin_required" }, 403);
  // The live session query rejects stale JWT/cookie pairs. Permit the sign-in page despite an expired cookie.
  const location = user ? returnPath : `/sign-in?session_cleared=1&agent_return=${encodeURIComponent(returnPath)}`;
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
