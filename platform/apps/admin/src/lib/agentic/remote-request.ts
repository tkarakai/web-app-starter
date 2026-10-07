/** Shared remote ingress policy. Credentials stay host context, never capability arguments. */
import { api } from "@repo/backend";
import { bearer } from "@web-app-starter/agentic/oauth";
import { backendClient, convexAdapter, convexCatalogue } from "./convex-adapter";
import { agentConfig, allowedRequest, privateJson, remoteResource, type RemoteSurface } from "./config";
import { agentRateLimit } from "./rate-limit";
export async function remoteRequest(request: Request, surface: RemoteSurface) {
  const config = agentConfig(); const resource = remoteResource(surface);
  if (!config || !resource) return { response: new Response(null, { status: 404 }) };
  const limited = agentRateLimit(); if (limited) return { response: limited };
  if (!allowedRequest(request, config.origin)) return { response: privateJson({ error: "invalid_origin" }, 403) };
  const client = backendClient();
  if (!(await client.query(api.platform.agentSurfaces.availability, { surface })).enabled) return { response: privateJson({ error: "surface_disabled" }, 503) };
  const challenge = { "WWW-Authenticate": `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource${new URL(resource).pathname}"` };
  const token = bearer(request.headers);
  if (!token) return { response: privateJson({ error: "unauthorized" }, 401, challenge) };
  try { await client.query(api.platform.agentAccess.inspect, { token, resource }); }
  catch { return { response: privateJson({ error: "unauthorized" }, 401, challenge) }; }
  const catalogue = await convexCatalogue(client, token, resource);
  return { client, token, resource, catalogue, adapter: convexAdapter(client, token, resource, catalogue) };
}
export async function limitedBody(request: Request, limit = 100_000) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new Error("REQUEST_TOO_LARGE");
  const reader = request.body?.getReader(); if (!reader) throw new Error("INVALID_REQUEST");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("REQUEST_TOO_LARGE"); }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
