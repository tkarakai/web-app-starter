"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Switch } from "@web-app-starter/design-system";
type Surface = "mcp" | "cli" | "webmcp" | "a2a";
const labels: Record<Surface, { title: string; description: string }> = {
  mcp: { title: "MCP server", description: "Let authenticated agents discover and use administration capabilities." },
  cli: { title: "Admin CLI", description: "Administer the application from the authenticated command-line client." },
  webmcp: { title: "WebMCP", description: "Offer capabilities to browser agents in an authenticated admin page." },
  a2a: { title: "A2A", description: "Let authenticated agents submit administration tasks through Agent2Agent." },
};
export function AgentSurfaceCard({ surface, deploymentReady }: { surface: Surface; deploymentReady: boolean }) {
  const config = useQuery(api.platform.agentSurfaces.configuration, {});
  const setEnabled = useMutation(api.platform.agentSurfaces.setEnabled);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const value = config?.surfaces[surface]; const { title, description } = labels[surface];
  const ready = surface === "webmcp" || deploymentReady && config?.configured;
  async function change(enabled: boolean) {
    setBusy(true); setError("");
    try { await setEnabled({ surface, enabled }); } catch { setError(`Could not change ${title} access. Complete recent authentication and try again.`); }
    finally { setBusy(false); }
  }
  return <Card className="max-w-3xl">
    <CardHeader><CardTitle className="text-lg">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between gap-4"><Label htmlFor={`agent-${surface}-enabled`}>Enable {title}</Label>
        <Switch id={`agent-${surface}-enabled`} checked={value?.enabled ?? false} disabled={busy || !value || (!ready && !value.enabled)} onCheckedChange={change} /></div>
      <p className="text-sm text-muted-foreground">{surface === "webmcp" ? "Uses the current admin session. Disabling removes browser tools and blocks their backend requests. Browser support is required; this switch does not install a browser extension." : "Disabling stops requests and invalidates this interface's grants. Re-enabling requires new authorization. Other interfaces keep their own controls."}</p>
      {!ready && <p className="text-sm text-muted-foreground">Configure the canonical admin and separate authorization origins before enabling this interface.</p>}
      {surface !== "webmcp" && <a href="/settings/agent-grants" className="text-sm underline">Manage your agent grants</a>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
