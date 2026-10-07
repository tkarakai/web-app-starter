/** Released A2A 1.0 JSON-RPC binding and the worker's structured command contract. */
import { z } from "zod";
import { gatewaySchemas, type CapabilityCatalogue } from "./discovery";
export const A2A_VERSION = "1.0";
export const commandSchema = z.object({ operation: z.enum(["search", "describe", "execute"]), input: z.record(z.string(), z.unknown()).default({}) }).strict();
export const messageRequest = z.object({
  message: z.object({ messageId: z.string().min(1).max(150), role: z.literal("ROLE_USER"), contextId: z.string().max(150).optional(), taskId: z.string().max(150).optional(), parts: z.array(z.object({ text: z.string().max(1000).optional(), data: z.unknown().optional(), mediaType: z.string().optional() }).passthrough().refine(part => ["text", "data", "raw", "url"].filter(key => part[key] !== undefined).length === 1, "A part must contain exactly one content value")).min(1).max(5) }).passthrough(),
  configuration: z.object({ returnImmediately: z.boolean().default(false), historyLength: z.number().int().min(0).max(100).optional(), acceptedOutputModes: z.array(z.string()).max(10).optional(), taskPushNotificationConfig: z.unknown().optional() }).passthrough().optional(),
}).passthrough();
export function validateCommand(value: unknown, catalogue: CapabilityCatalogue) {
  const command = commandSchema.parse(value);
  const schema = gatewaySchemas[`capabilities_${command.operation}`];
  const input = schema.parse(command.input);
  if (command.operation === "execute") {
    const execution = gatewaySchemas.capabilities_execute.parse(input);
    const definition = Object.prototype.hasOwnProperty.call(catalogue, execution.name) ? catalogue[execution.name] : undefined; if (!definition) throw new Error("UNKNOWN_CAPABILITY");
    definition.schema.parse(execution.input);
    if (execution.resultOffset && definition.effect !== "read") throw new Error("WRITE_OUTPUT_CANNOT_BE_REPLAYED");
  }
  return { operation: command.operation, input };
}
export function a2aAgentCard(origin: string, issuer: string, name: string) {
  return { name: `${name} admin capability worker`, description: "Execute structured administration tasks. A caller such as the pi tester plans natural-language requests; this worker has no server-side inference provider. Discover capabilities using a data part with {operation:'search',input:{query:'users'}}; describe and execute use the same bounded gateway contract.", version: "0.1.0",
    supportedInterfaces: [{ url: `${origin}/api/a2a`, protocolBinding: "JSONRPC", protocolVersion: A2A_VERSION }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false }, defaultInputModes: ["application/json", "text/plain"], defaultOutputModes: ["application/json"],
    securitySchemes: { adminOAuth: { oauth2SecurityScheme: { flows: { authorizationCode: { authorizationUrl: `${issuer}/api/agent/authorize`, tokenUrl: `${issuer}/api/agent/token`, scopes: { "admin:manage": "Administer the application as the authorizing user" }, pkceRequired: true } }, oauth2MetadataUrl: `${issuer}/.well-known/oauth-authorization-server` } } },
    securityRequirements: [{ schemes: { adminOAuth: { list: ["admin:manage"] } } }],
    skills: [{ id: "admin-capabilities", name: "Discover and execute admin capabilities", description: "Send one structured search, describe or execute command in a Message data part. Text-only requests return input-required with guidance. Password/biometric ceremonies require the person in the secure UI. Tasks are owned, cancelable before commit, deduplicated by messageId and retained for 24 hours (up to 200 per user).", tags: ["admin", "capabilities", "announcements", "users", "security"], examples: ['{"operation":"execute","input":{"name":"announcements_create","input":{"name":"Draft","bannerText":"Hello"}}}'] }],
  };
}
export function a2aError(id: unknown, code: number, message: string) { return { jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" ? id : null, error: { code, message } }; }

/** Convex stores/returns artifact JSON as text because JSON Schema dollar keys are reserved there. */
export function a2aWireValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.task) return { ...record, task: a2aWireValue(record.task) };
  if (Array.isArray(record.tasks)) return { ...record, tasks: record.tasks.map(a2aWireValue) };
  if (!Array.isArray(record.artifacts)) return value;
  return { ...record, artifacts: record.artifacts.map(artifact => {
    const item = artifact as { parts?: { text?: string; mediaType?: string }[] };
    return { ...item, parts: item.parts?.map(part => part.mediaType === "application/json" && typeof part.text === "string" ? { data: JSON.parse(part.text), mediaType: part.mediaType } : part) };
  }) };
}
