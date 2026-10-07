/** Optional acceptance evidence: identifiers/hashes and outcomes, no credentials or application text. */
import { createHash } from "node:crypto";
import type { AdminToolConnection } from "./client";
export interface ToolEvidence { tool: string; capability?: string; success: boolean; announcementId?: string; createdAnnouncementId?: string; nameHash?: string; bannerHash?: string; absent?: boolean; }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function instrumentConnection(connection: AdminToolConnection, evidence: ToolEvidence[]): AdminToolConnection {
  return { listTools: () => connection.listTools(), close: () => connection.close(), async callTool(input, unused, options) {
    const name = typeof input.arguments?.name === "string" ? input.arguments.name : undefined;
    const args = input.arguments?.input as Record<string, unknown> | undefined;
    const event: ToolEvidence = { tool: input.name, capability: name, success: false };
    try {
      const result = await connection.callTool(input, unused, options); event.success = !result.isError;
      if (event.success && name?.startsWith("announcements_")) {
        if (typeof args?.announcementId === "string") event.announcementId = args.announcementId;
        const content = result.content as { type: string; text?: string }[];
        const decoded = JSON.parse(content.find(item => item.type === "text")?.text ?? "{}");
        const row = decoded?.result;
        if (name === "announcements_create" && typeof row?.id === "string") { event.createdAnnouncementId = row.id; if (typeof args?.name === "string") event.nameHash = hash(args.name); }
        if (name === "announcements_get") { event.absent = row === null; if (typeof row?.bannerText === "string") event.bannerHash = hash(row.bannerText); }
      }
      return result;
    } finally { evidence.push(event); }
  } };
}
