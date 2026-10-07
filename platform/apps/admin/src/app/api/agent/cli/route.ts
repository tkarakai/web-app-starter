/** Deliberately small CLI transport, separate from MCP and its availability control. */
import { searchCapabilities, describeCapabilities, executeCapability } from "@web-app-starter/agentic/discovery";
import { safeCapabilityError } from "@web-app-starter/agentic/errors";
import { remoteRequest, limitedBody } from "@/lib/agentic/remote-request";
import { privateJson } from "@/lib/agentic/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await remoteRequest(request, "cli"); if (auth.response) return auth.response;
  try {
    const body = JSON.parse(new globalThis.TextDecoder().decode(await limitedBody(request))) as { operation?: unknown; input?: unknown };
    const result = body.operation === "search" ? searchCapabilities(auth.catalogue!, body.input)
      : body.operation === "describe" ? describeCapabilities(auth.catalogue!, body.input)
      : body.operation === "execute" ? await executeCapability(auth.adapter!, auth.catalogue!, body.input, request.signal)
      : undefined;
    if (result === undefined) return privateJson({ error: "invalid_operation" }, 400);
    return privateJson({ result });
  } catch (error) { return privateJson({ error: safeCapabilityError(error) }, 400); }
}
