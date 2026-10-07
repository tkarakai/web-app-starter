"use client";
import { useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@repo/backend";
import { Button, AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter } from "@web-app-starter/design-system";
import type { validateAuthorization } from "@web-app-starter/agentic/oauth";

type AuthorizationRequest = ReturnType<typeof validateAuthorization> & { resource: string };

export function AgentAccess({ request }: { request: AuthorizationRequest }) {
  const availability = useQuery(api.platform.agentSurfaces.availability, { surface: request.resource.endsWith("/api/a2a") ? "a2a" : request.resource.endsWith("/api/agent/cli") ? "cli" : "mcp" });
  const denyButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approve" | "deny") {
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/agent/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, request }) });
      const result = await response.json() as { redirect?: string; error?: string };
      if (!response.ok || !result.redirect) throw new Error(result.error ?? "decision_failed");
      window.location.assign(result.redirect);
    } catch (error) {
      setError(error instanceof Error && error.message === "mcp_disabled" ? "This agent surface is disabled. No access was granted." : "Cannot finish authorization. Complete recent authentication, then try again.");
      setBusy(false);
    }
  }

  return <AlertDialog open>
    <AlertDialogContent aria-modal="true" className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] overflow-y-auto sm:max-w-lg"
      onEscapeKeyDown={event => event.preventDefault()}
      onOpenAutoFocus={event => { event.preventDefault(); denyButton.current?.focus(); }}>
      <AlertDialogHeader>
        <AlertDialogTitle>Authorize admin agent</AlertDialogTitle>
        <AlertDialogDescription>Allow this agent to administer the application as you?</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-4 text-sm">
        <p className="font-medium">Interface: {request.resource.endsWith("/api/a2a") ? "Agent2Agent (A2A)" : request.resource.endsWith("/api/agent/cli") ? "Admin CLI" : "MCP"}</p>
        <p>It can use all available administration capabilities as you, including reading private admin data, managing users and invitations, changing settings and security policy, and publishing or permanently deleting content. Native permissions and security requirements still apply.</p>
        <p>Access lasts up to 15 minutes and uses the verification completed for this request. Writes require authentication within the last five minutes.</p>
        <p className="text-muted-foreground">Only approve if you started and trust this agent yourself. Your decision returns to the agent on this computer.</p>
        {availability && !availability.enabled && <p role="alert">This agent surface is disabled. You can deny this request.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <AlertDialogFooter className="gap-2">
        <Button ref={denyButton} variant="outline" disabled={busy} onClick={() => void decide("deny")}>Deny access</Button>
        <Button onClick={() => void decide("approve")} disabled={busy || !availability?.enabled}>{busy ? "Authorizing…" : "Authorize admin agent"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
