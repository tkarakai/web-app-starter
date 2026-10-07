import { appConfig } from "@web-app-starter/app-config";
import { api } from "@repo/backend";
import { a2aAgentCard } from "@web-app-starter/agentic/a2a";
import { agentConfig, allowedRequest, privateJson } from "@/lib/agentic/config";
import { backendClient } from "@/lib/agentic/convex-adapter";
export async function GET(request: Request) {
  const config = agentConfig(); if (!config) return new Response(null, { status: 404 });
  if (!allowedRequest(request, config.origin)) return new Response(null, { status: 403 });
  if (!(await backendClient().query(api.platform.agentSurfaces.availability, { surface: "a2a" })).enabled) return privateJson({ error: "surface_disabled" }, 503);
  return privateJson(a2aAgentCard(config.origin, config.authorizationOrigin, appConfig.identity.productName));
}
