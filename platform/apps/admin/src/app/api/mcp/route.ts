import { handleMcp } from "@web-app-starter/agentic/mcp";
import { remoteRequest, limitedBody } from "@/lib/agentic/remote-request";
import { agentConfig, privateJson } from "@/lib/agentic/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await remoteRequest(request, "mcp");
  if (auth.response) return auth.response;
  let body;
  try { body = await limitedBody(request); } catch { return privateJson({ error: "invalid_request_or_size" }, 413); }
  const response = await handleMcp(new Request(request.url, { method: "POST", headers: request.headers, body }), auth.adapter!, auth.catalogue!);
  response.headers.set("Cache-Control", "no-store"); return response;
}
export function GET() { return new Response(null, { status: agentConfig() ? 405 : 404 }); }
export const DELETE = GET;
