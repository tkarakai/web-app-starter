import { ConvexHttpClient } from "convex/browser";
import { api } from "@repo/backend";
import type { CapabilityAdapter } from "@web-app-starter/agentic/adapter";
import { announcementCatalogue } from "@web-app-starter/agentic/catalogue";
export function backendClient() {
  const url = process.env.CONVEX_URL;
  if (!url) throw new Error("CONVEX_URL is required");
  return new ConvexHttpClient(url);
}
export function convexAdapter(client: ConvexHttpClient, token: string, resource: string): CapabilityAdapter {
  const auth = { token, resource };
  return { async execute(name, input) {
    // Parse locally for non-MCP future callers as well; native validators validate again in Convex.
    switch (name) {
      case "announcements_list": return client.query(api.platform.agentAnnouncements.list, { ...auth, ...announcementCatalogue.announcements_list.schema.parse(input) });
      case "announcements_get": return client.query(api.platform.agentAnnouncements.get, { ...auth, ...announcementCatalogue.announcements_get.schema.parse(input) });
      case "announcements_create": return client.mutation(api.platform.agentAnnouncements.create, { ...auth, ...announcementCatalogue.announcements_create.schema.parse(input) });
      case "announcements_update": return client.mutation(api.platform.agentAnnouncements.update, { ...auth, ...announcementCatalogue.announcements_update.schema.parse(input) });
      case "announcements_delete": return client.mutation(api.platform.agentAnnouncements.remove, { ...auth, ...announcementCatalogue.announcements_delete.schema.parse(input) });
    }
  } };
}
