"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@web-app-starter/design-system";

export function AgentGrants() {
  const revoke = useMutation(api.platform.agentAccess.revoke);
  const grants = useQuery(api.platform.agentAccess.listMine, {});
  const [error, setError] = useState("");
  async function revokeGrant(grantId: Parameters<typeof revoke>[0]["grantId"]) {
    setError("");
    try { await revoke({ grantId }); } catch { setError("Could not revoke access. Complete recent authentication and try again."); }
  }
  return <div className="mx-auto max-w-2xl p-6">
    <Card><CardHeader><CardTitle>Your agent grants</CardTitle></CardHeader><CardContent className="space-y-3">
      {grants?.map(grant => <div key={grant._id} className="flex flex-wrap items-center justify-between gap-3">
        <span>{grant.clientId} · {grant.revokedAt ? "revoked" : new Date(grant.expiresAt).toLocaleString()}</span>
        {!grant.revokedAt && <Button variant="outline" onClick={() => revokeGrant(grant._id)}>Revoke</Button>}
      </div>)}
      {grants?.length === 0 && <p>No agent grants.</p>}
      {error && <p role="alert">{error}</p>}
    </CardContent></Card>
  </div>;
}
