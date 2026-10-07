"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend";
import { Button, AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter } from "@web-app-starter/design-system";
import type { validateAuthorization } from "@web-app-starter/agentic/oauth";

type AuthorizationRequest = ReturnType<typeof validateAuthorization> & { resource: string };

export function AgentAccess({ request }: { request: AuthorizationRequest }) {
  const availability = useQuery(api.platform.agentMcp.availability, {});
  const authorize = useMutation(api.platform.agentAccess.authorize);
  const denyButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function finish(params: Record<string, string>) {
    // The server validated the exact loopback callback and resource before rendering consent.
    const callback = new URL(request.redirectUri);
    callback.search = new URLSearchParams({ ...params, state: request.state }).toString();
    window.location.assign(callback.href);
  }
  async function approve() {
    setError(""); setBusy(true);
    try {
      const { clientId, redirectUri, resource, challenge, scope } = request;
      const { code } = await authorize({ clientId, redirectUri, resource, challenge, scope });
      finish({ code });
    } catch (error) {
      setError(error instanceof Error && error.message.includes("MCP_DISABLED") ? "The MCP server is disabled. No access was granted." : "Cannot authorize this request. Complete recent authentication, then try again.");
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
        <p>Access lasts up to 15 minutes and stays linked to this authorization session. Writes require authentication within the last five minutes.</p>
        <p className="text-muted-foreground">Only approve if you started this pi agent yourself. Your decision returns to the agent on this computer.</p>
        {availability && !availability.enabled && <p role="alert">The MCP server is disabled. You can deny this request.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
      <AlertDialogFooter className="gap-2">
        <Button ref={denyButton} variant="outline" disabled={busy} onClick={() => finish({ error: "access_denied" })}>Deny access</Button>
        <Button onClick={approve} disabled={busy || !availability?.enabled}>{busy ? "Authorizing…" : "Authorize pi announcement agent"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
