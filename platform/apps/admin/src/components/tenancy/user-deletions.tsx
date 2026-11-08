"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@repo/backend";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web-app-starter/design-system";
import { countdown } from "@/lib/tenancy";

const REASONS: Record<string, string> = {
  BILLING_ORGANIZATION_IN_USE: "Last member of a billing organization that pays for other organizations",
  BILLING_OWNER_REQUIRED: "Last owner of a billing organization that pays for other organizations",
};

/**
 * Users who asked to delete themselves: when it happens, or why it couldn't. A stalled deletion
 * (its run stopped without finishing) can be retried, and cancelled only while nothing of the
 * user has been deleted. A deleted user's cleanup (memberships one organization at a time, then
 * their data) shows its progress, and can be retried once it failed or stalled.
 */
export function UserDeletions() {
  const list = useQuery(api.platform.userDeletion.list);
  const rows = list?.rows;
  const cancel = useMutation(api.platform.userDeletion.adminCancel);
  const retry = useMutation(api.platform.userDeletion.adminRetryCleanup);
  const retryDeletion = useMutation(api.platform.userDeletion.adminRetry);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!rows || rows.length === 0) return null;

  return (
    <Card data-testid="user-deletions">
      <CardHeader>
        <CardTitle className="text-lg">Scheduled deletions</CardTitle>
        <CardDescription>Users who asked to delete themselves. Signing in lets them cancel until the date.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Deletion</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.userId}>
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  <div className="text-sm text-muted-foreground">{row.email}</div>
                </TableCell>
                <TableCell>
                  {row.state === "cleanup_pending" ? <>
                    <Badge variant={row.retryable ? "destructive" : "secondary"}>{row.stale ? "Cleanup stalled" : row.retryable ? "Cleanup pending" : "Cleaning up"}</Badge>{" "}
                    <span className="text-sm text-muted-foreground">{row.removedMemberships > 0 ? `${row.removedMemberships} memberships removed. ` : ""}{row.blockedReason}</span>
                  </> : row.state === "deleting"
                    ? row.stale ? <><Badge variant="destructive">Stalled</Badge> <span className="text-sm text-muted-foreground">The deletion stopped without finishing. Retry it{row.cancelable ? " or cancel it" : ""}.</span></> : <Badge variant="secondary">Deleting</Badge>
                    : row.state === "blocked"
                    ? <><Badge variant="destructive">Blocked</Badge> <span className="text-sm text-muted-foreground">{REASONS[row.blockedReason ?? ""] ?? row.blockedReason}</span></>
                    : <span title={new Date(row.deleteAt).toLocaleString()}>Scheduled {countdown(row.deleteAt, now)}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {row.state === "cleanup_pending" ? <Button disabled={!row.retryable} size="sm" variant="outline" onClick={() => void retry({ userId: row.userId }).then(() => toast.success("Cleanup retry scheduled."), () => toast.error("Couldn't retry cleanup."))}>Retry cleanup</Button> : <div className="flex justify-end gap-2">
                    {row.state === "deleting" && row.stale && <Button size="sm" variant="outline" onClick={() => void retryDeletion({ userId: row.userId }).then(() => toast.success("Deletion retry scheduled."), () => toast.error("Couldn't retry the deletion."))}>Retry deletion</Button>}
                    <Button disabled={!row.cancelable} size="sm" variant="outline" onClick={() => void cancel({ userId: row.userId }).then(() => toast.success(`Deletion of ${row.email} canceled.`), () => toast.error("Couldn't cancel the deletion."))}>
                      Cancel deletion
                    </Button>
                  </div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list?.more && <p className="mt-3 text-sm text-muted-foreground">Showing the first 200 deletions and 200 cleanups; more are waiting.</p>}
      </CardContent>
    </Card>
  );
}
