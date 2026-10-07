"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@web-app-starter/design-system";
import { validateAuthorization } from "@web-app-starter/agentic/oauth";

export function AgentAccess() {
  const authorize = useMutation(api.platform.agentAccess.authorize);
  const revoke = useMutation(api.platform.agentAccess.revoke);
  const grants = useQuery(api.platform.agentAccess.listMine, {});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Read only on click so static rendering has no browser or search-param dependency.
  async function approve() {
    setError(""); setBusy(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const request = validateAuthorization(params);
      const resource = `${window.location.origin}/api/mcp`;
      if (params.get("resource") !== resource) throw new Error("Wrong MCP resource");
      const { state, ...input } = request;
      const { code } = await authorize({ ...input, resource });
      const callback = new URL(request.redirectUri);
      callback.searchParams.set("code", code); callback.searchParams.set("state", state);
      window.location.assign(callback.href);
    } catch {
      setError("Cannot authorize this request. Check the client URL and complete recent authentication, then try again.");
      setBusy(false);
    }
  }
  async function revokeGrant(grantId: Parameters<typeof revoke>[0]["grantId"]) {
    try { await revoke({ grantId }); } catch { setError("Could not revoke access. Complete recent authentication and try again."); }
  }
  return <div className="mx-auto max-w-2xl space-y-6 p-6">
    <Card><CardHeader><CardTitle>Announcement agent access</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>Authorize the pi announcement test agent to list, read, create, update and permanently delete announcements as you.</p>
      <p>This grant lasts up to 15 minutes and ends when your admin session expires or is revoked. Writes require recent authentication. Updates to live announcements affect public content.</p>
      <p>Only approve after starting the test agent yourself. It returns to a callback on your computer.</p>
      <Button onClick={approve} disabled={busy}>{busy ? "Authorizing…" : "Authorize pi announcement agent"}</Button>
      <p><a href="/settings" className="underline">Cancel and return to settings</a></p>
      {error && <p role="alert">{error}</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Your agent grants</CardTitle></CardHeader><CardContent className="space-y-3">
      {grants?.map(grant => <div key={grant._id} className="flex flex-wrap items-center justify-between gap-3">
        <span>{grant.clientId} · {grant.revokedAt ? "revoked" : new Date(grant.expiresAt).toLocaleString()}</span>
        {!grant.revokedAt && <Button variant="outline" onClick={() => revokeGrant(grant._id)}>Revoke</Button>}
      </div>)}
      {grants?.length === 0 && <p>No agent grants.</p>}
    </CardContent></Card>
  </div>;
}
