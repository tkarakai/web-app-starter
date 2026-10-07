"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Switch } from "@web-app-starter/design-system";

export function McpFeatureCard({ deploymentReady }: { deploymentReady: boolean }) {
  const config = useQuery(api.platform.agentMcp.configuration, {});
  const setEnabled = useMutation(api.platform.agentMcp.setEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(enabled: boolean) {
    setBusy(true); setError("");
    try { await setEnabled({ enabled }); } catch { setError("Could not change MCP access. Complete recent authentication and try again."); }
    finally { setBusy(false); }
  }
  const ready = deploymentReady && config?.configured;
  return <Card className="max-w-3xl">
    <CardHeader><CardTitle className="text-lg">MCP server</CardTitle><CardDescription>Allow authenticated agents to manage announcements.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between gap-4"><Label htmlFor="mcp-server-enabled">Enable MCP server</Label>
        <Switch id="mcp-server-enabled" checked={config?.enabled ?? false} disabled={busy || !config || (!ready && !config.enabled)} onCheckedChange={change} /></div>
      <p className="text-sm text-muted-foreground">Disabling stops new authorizations and invalidates existing agent access. Re-enabling requires agents to authorize again.</p>
      {!ready && <p className="text-sm text-muted-foreground">The deployment must configure the MCP resource and separate authorization origin before this feature can be enabled.</p>}
      <a href="/settings/agent-grants" className="text-sm underline">Manage your agent grants</a>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
