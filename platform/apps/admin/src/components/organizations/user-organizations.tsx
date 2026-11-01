"use client";

import { useQuery } from "convex/react";
import { api } from "@repo/backend";

import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@web-app-starter/design-system";
import type { AdminUser } from "@/lib/admin-api";

/** What deleting the account does to one organization, in words. */
function deletionOutcome(membership: {
  onAccountDeletion: "organizationDeleted" | "ownershipPasses" | "membershipRemoved";
  successor: { name: string; email: string } | null;
}): string {
  if (membership.onAccountDeletion === "organizationDeleted") return "Deleted with its app data: no other members";
  if (membership.onAccountDeletion === "ownershipPasses") return `Ownership passes to ${membership.successor?.email ?? "another member"}`;
  return "Membership removed";
}

/** A user's organizations and roles; with `deletionImpact`, what deleting the account would do to each. */
export function UserOrganizationsList({ userId, deletionImpact = false }: { userId: string; deletionImpact?: boolean }) {
  const memberships = useQuery(api.platform.adminOrganizations.forUser, { userId });
  if (memberships === undefined) return <Skeleton className="h-16 w-full" />;
  if (memberships === null) return null;
  if (memberships.length === 0) {
    return <p className="text-sm text-muted-foreground">{deletionImpact ? "Not a member of any organization." : "No organization memberships."}</p>;
  }
  return (
    <ul className="divide-y divide-border/60 rounded-md border" data-testid="user-organizations">
      {memberships.map((membership) => (
        <li key={membership.organizationId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{membership.name || membership.organizationId}</span>
          <Badge variant={membership.role === "member" ? "secondary" : "default"}>{membership.role}</Badge>
          {membership.soleOwner && <Badge variant="outline">Only owner</Badge>}
          <span className="text-xs text-muted-foreground">
            {deletionImpact ? deletionOutcome(membership) : `${membership.memberCount} member${membership.memberCount === 1 ? "" : "s"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

type UserOrganizationsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUser | null;
};

export function UserOrganizationsDialog({ open, onOpenChange, user }: UserOrganizationsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Organizations</DialogTitle>
          <DialogDescription>{user ? `Organizations ${user.email} belongs to.` : ""}</DialogDescription>
        </DialogHeader>
        {user && <UserOrganizationsList userId={user.id} />}
      </DialogContent>
    </Dialog>
  );
}
