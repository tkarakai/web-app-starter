import { agentRateLimit } from "@/lib/agentic/rate-limit";
import { isAuthenticated } from "@web-app-starter/auth/server";
import { validateAuthorization } from "@web-app-starter/agentic/oauth";
import { agentConfig, allowedRequest, privateJson } from "@/lib/agentic/config";
export async function GET(request: Request) {
  const config = agentConfig();
  if (!config) return new Response(null, { status: 404 });
  const limited = agentRateLimit(); if (limited) return limited;
  if (!allowedRequest(request, config.origin)) return privateJson({ error: "invalid_origin" }, 403);
  const params = new URL(request.url).searchParams;
  try {
    validateAuthorization(params);
    if (params.get("resource") !== config.resource) throw new Error("Wrong resource");
  } catch { return privateJson({ error: "invalid_request" }, 400); }
  const returnPath = `/settings/agent-access?${params.toString()}`;
  const location = await isAuthenticated() ? returnPath : `/sign-in?agent_return=${encodeURIComponent(returnPath)}`;
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
