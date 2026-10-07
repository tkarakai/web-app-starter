import { agentConfig, privateJson } from "@/lib/agentic/config";
export function GET() {
  const config = agentConfig();
  if (!config) return new Response(null, { status: 404 });
  return privateJson({ issuer: config.authorizationOrigin, authorization_endpoint: `${config.authorizationOrigin}/api/agent/authorize`, token_endpoint: `${config.authorizationOrigin}/api/agent/token`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["announcements:manage"] });
}
