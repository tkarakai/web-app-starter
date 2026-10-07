"use client";
import { useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@repo/backend";
import { Button, AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter } from "@web-app-starter/design-system";
import type { validateAuthorization } from "@web-app-starter/agentic/oauth";

type AuthorizationRequest = ReturnType<typeof validateAuthorization> & { resource: string };

export function AgentAccess({ request }: { request: AuthorizationRequest }) {
  const availability = useQuery(api.platform.agentMcp.availability, {});
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
      setError(error instanceof Error && error.message === "mcp_disabled" ? "The MCP server is disabled. No access was granted." : "Cannot finish authorization. Complete recent authentication, then try again.");
      setBusy(false);
    }
  }

  return <AlertDialog open>
    <AlertDialogContent aria-modal="true" className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] overflow-y-auto sm:max-w-lg"
      onEscapeKeyDown={event => event.preventDefault()}
      onOpenAutoFocus={event => { event.preventDefault(); denyButton.current?.focus(); }}>
      <AlertDialogHeader>
        <AlertDialogTitle>Authorize announcement agent</AlertDialogTitle>
        <AlertDialogDescription>Allow the pi test agent to manage announcements as you?</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-4 text-sm">
        <p>It can list, read, create, update and permanently delete announcements. Updates to live announcements affect public content.</p>
        <p>Access lasts up to 15 minutes and uses the verification completed for this request. Writes require authentication within the last five minutes.</p>
        <p className="text-muted-foreground">Only approve if you started this pi agent yourself. Your decision returns to the agent on this computer.</p>
        {availability && !availability.enabled && <p role="alert">The MCP server is disabled. You can deny this request.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <AlertDialogFooter className="gap-2">
        <Button ref={denyButton} variant="outline" disabled={busy} onClick={() => void decide("deny")}>Deny access</Button>
        <Button onClick={() => void decide("approve")} disabled={busy || !availability?.enabled}>{busy ? "Authorizing…" : "Authorize pi announcement agent"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
