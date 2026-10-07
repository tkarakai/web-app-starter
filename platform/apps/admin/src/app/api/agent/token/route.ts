import { agentRateLimit } from "@/lib/agentic/rate-limit";
import { api } from "@repo/backend";
import { backendClient } from "@/lib/agentic/convex-adapter";
import { agentConfig, allowedRequest, privateJson } from "@/lib/agentic/config";
export async function POST(request: Request) {
  const config = agentConfig();
  if (!config) return new Response(null, { status: 404 });
  const limited = agentRateLimit(); if (limited) return limited;
  if (!(await backendClient().query(api.platform.agentMcp.availability, {})).enabled) return privateJson({ error: "mcp_disabled" }, 503);
  if (!allowedRequest(request, config.authorizationOrigin)) return privateJson({ error: "invalid_origin" }, 403);
  const raw = await request.text();
  if (raw.length > 4096) return privateJson({ error: "invalid_request" }, 400);
  const params = new URLSearchParams(raw);
  if (params.get("grant_type") !== "authorization_code" || params.get("resource") !== config.resource)
    return privateJson({ error: "invalid_request" }, 400);
  try {
    return privateJson(await backendClient().mutation(api.platform.agentAccess.exchange, {
      code: params.get("code") ?? "", verifier: params.get("code_verifier") ?? "", clientId: params.get("client_id") ?? "",
      redirectUri: params.get("redirect_uri") ?? "", resource: config.resource,
    }));
  } catch { return privateJson({ error: "invalid_grant" }, 400); }
}
