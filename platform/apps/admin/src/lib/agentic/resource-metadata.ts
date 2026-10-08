import { SCOPE } from "@web-app-starter/agentic/oauth";
import { agentConfig, privateJson, remoteResource, type RemoteSurface } from "./config";
export function resourceMetadata(surface: RemoteSurface) {
  const config = agentConfig(); if (!config) return new Response(null, { status: 404 });
  return privateJson({ resource: remoteResource(surface), authorization_servers: [config.authorizationOrigin], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] });
}
