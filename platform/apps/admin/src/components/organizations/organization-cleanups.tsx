"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@repo/backend";

import { Badge, Button } from "@web-app-starter/design-system";
import { organizationErrorMessage } from "./organization-errors";

/**
 * Removals of deleted organizations' app data that need attention: failed ones (after automatic
 * retries) and stalled ones (their run stopped without reporting) with Retry, and ones still
 * running. Hidden when there are none.
 */
export function OrganizationCleanups() {
  const cleanups = useQuery(api.platform.adminOrganizations.cleanups, {});
  const retry = useMutation(api.platform.adminOrganizations.retryCleanup);
  const [pending, setPending] = React.useState<string | null>(null);
  if (!cleanups || cleanups.length === 0) return null;

  const onRetry = async (organizationId: string) => {
    setPending(organizationId);
    try {
      await retry({ organizationId });
      toast.success("Cleanup restarted");
    } catch (error) {
      toast.error(organizationErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <section aria-labelledby="organization-cleanups" className="space-y-2 rounded-md border p-4">
      <h2 id="organization-cleanups" className="text-sm font-semibold">Data cleanup of deleted organizations</h2>
      <ul className="space-y-2">
        {cleanups.map((cleanup) => (
          <li key={cleanup.organizationId} className="flex flex-wrap items-center gap-2 text-sm">
            <code className="text-xs">{cleanup.organizationId}</code>
            <Badge variant={cleanup.state === "failed" || cleanup.stale ? "destructive" : "secondary"}>{cleanup.state === "failed" ? "Failed" : cleanup.stale ? "Stalled" : "Running"}</Badge>
            <span className="text-muted-foreground">{cleanup.batches} batches</span>
            {cleanup.lastError && <span className="truncate text-muted-foreground" title={cleanup.lastError}>{cleanup.lastError.slice(0, 120)}</span>}
            {(cleanup.state === "failed" || cleanup.stale) && (
              <Button size="sm" variant="outline" disabled={pending === cleanup.organizationId} onClick={() => onRetry(cleanup.organizationId)}>
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
