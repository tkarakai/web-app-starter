import { agentRateLimit } from "@/lib/agentic/rate-limit";
import { handleMcp } from "@web-app-starter/agentic/mcp";
import { bearer } from "@web-app-starter/agentic/oauth";
import { api } from "@repo/backend";
import { backendClient, convexAdapter, convexCatalogue } from "@/lib/agentic/convex-adapter";
import { agentConfig, allowedRequest, privateJson } from "@/lib/agentic/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const config = agentConfig();
  if (!config) return new Response(null, { status: 404 });
  const limited = agentRateLimit(); if (limited) return limited;
  if (!(await backendClient().query(api.platform.agentMcp.availability, {})).enabled) return privateJson({ error: "mcp_disabled" }, 503);
  if (!allowedRequest(request, config.origin)) return privateJson({ error: "invalid_origin" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 100_000) return privateJson({ error: "request_too_large" }, 413);
  const token = bearer(request.headers);
  const challenge = { "WWW-Authenticate": `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/api/mcp"` };
  if (!token) return privateJson({ error: "unauthorized" }, 401, challenge);
  const client = backendClient();
  try { await client.query(api.platform.agentAccess.inspect, { token, resource: config.resource }); }
  catch { return privateJson({ error: "unauthorized" }, 401, challenge); }
  // Buffer with a hard bound even when Content-Length is missing or incorrect.
  const reader = request.body?.getReader();
  if (!reader) return privateJson({ error: "invalid_request" }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 100_000) { await reader.cancel(); return privateJson({ error: "request_too_large" }, 413); }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const catalogue = await convexCatalogue(client, token, config.resource);
  const response = await handleMcp(new Request(request.url, { method: "POST", headers: request.headers, body }), convexAdapter(client, token, config.resource, catalogue), catalogue);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export function GET() { return new Response(null, { status: agentConfig() ? 405 : 404 }); }
export const DELETE = GET;
