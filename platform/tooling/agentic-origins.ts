import { fileURLToPath } from "node:url";
import * as path from "node:path";

export function localAgentOrigins(adminUrl: string, resourceOrigin?: string, authOrigin?: string) {
  const admin = new URL(adminUrl);
  if (admin.protocol !== "http:" || admin.hostname !== "localhost" || admin.origin !== adminUrl) throw new Error("MCP dev origins require the managed local admin URL");
  if (resourceOrigin && resourceOrigin !== adminUrl) throw new Error("AGENT_MCP_ORIGIN must match the actual local admin URL");
  const issuer = new URL(authOrigin ?? `http://mcp-auth.localhost:${admin.port}`);
  if (issuer.origin !== (authOrigin ?? issuer.origin) || issuer.protocol !== "http:" || !issuer.hostname.endsWith(".localhost")
    || issuer.port !== admin.port || issuer.hostname === admin.hostname) throw new Error("Local MCP auth must use a distinct .localhost hostname on the admin port");
  return { origin: admin.origin, authorizationOrigin: issuer.origin, resource: admin.origin + "/api/mcp" };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const origins = localAgentOrigins(process.argv[2], process.env.AGENT_MCP_ORIGIN, process.env.AGENT_MCP_AUTH_ORIGIN);
  // Validated URL origins contain no quotes, shell expansion or path content.
  process.stdout.write(`AGENT_LOCAL_RESOURCE_ORIGIN='${origins.origin}'\nAGENT_LOCAL_AUTH_ORIGIN='${origins.authorizationOrigin}'\n`);
}
