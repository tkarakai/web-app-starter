import { agentConfig, privateJson } from "@/lib/agentic/config";
export function GET() {
  const config = agentConfig();
  if (!config) return new Response(null, { status: 404 });
  return privateJson({ resource: config.resource, authorization_servers: [config.origin], scopes_supported: ["announcements:manage"], bearer_methods_supported: ["header"] });
}
