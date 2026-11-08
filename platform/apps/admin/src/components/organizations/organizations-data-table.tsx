"use client";

import * as React from "react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "@repo/backend";

import {
  Badge,
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web-app-starter/design-system";
import { OrganizationDetailsDialog } from "./organization-details-dialog";

const PAGE_SIZE = 50;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function OrganizationsDataTable() {
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { results, status, loadMore } = usePaginatedQuery(
    api.platform.adminOrganizations.list,
    search ? { search } : {},
    { initialNumItems: PAGE_SIZE },
  );
  const loadingFirst = status === "LoadingFirstPage";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search by name (case-sensitive)..."
          aria-label="Search organizations"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        {!loadingFirst && (
          <span className="text-sm text-muted-foreground">
            {results.length} organization{results.length === 1 ? "" : "s"}{status === "CanLoadMore" ? "+" : ""}
          </span>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Owners</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Pending invitations</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingFirst && Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {Array.from({ length: 5 }).map((__, j) => (
                  <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!loadingFirst && results.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">No organizations found.</TableCell>
              </TableRow>
            )}
            {!loadingFirst && results.map((organization) => (
              <TableRow key={organization.id}>
                <TableCell>
                  <Button variant="link" className="h-auto p-0 font-medium" onClick={() => setOpenId(organization.id)}>
                    {organization.name}
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {organization.owners.map((owner: { userId: string; email: string; banned: boolean }) => (
                      <span key={owner.userId} className="text-sm">
                        {owner.email}
                        {owner.banned && <Badge variant="destructive" className="ms-1">Banned</Badge>}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{organization.memberCount}</TableCell>
                <TableCell>{organization.pendingInvitations}{organization.morePendingInvitations ? "+" : ""}</TableCell>
                <TableCell>{formatDate(organization.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => loadMore(PAGE_SIZE)} disabled={status === "LoadingMore"}>
            {status === "LoadingMore" ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      <OrganizationDetailsDialog organizationId={openId} onOpenChange={(open) => { if (!open) setOpenId(null); }} />
    </div>
  );
}
