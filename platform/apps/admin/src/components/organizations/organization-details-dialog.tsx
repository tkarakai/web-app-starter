"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@repo/backend";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web-app-starter/design-system";
import { ConfirmationDialog } from "@/components/users/confirmation-dialog";
import { organizationErrorMessage } from "./organization-errors";

type Props = {
  organizationId: string | null;
  onOpenChange: (open: boolean) => void;
};

type Confirm =
  | { kind: "addOwner"; userId: string; email: string }
  | { kind: "removeOwner"; userId: string; email: string }
  | { kind: "cancelInvitation"; invitationId: string; email: string };

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function OrganizationDetailsDialog({ organizationId, onOpenChange }: Props) {
  const organization = useQuery(
    api.platform.adminOrganizations.get,
    organizationId ? { organizationId } : "skip",
  );
  const addOwner = useMutation(api.platform.adminOrganizations.addOwner);
  const removeOwner = useMutation(api.platform.adminOrganizations.removeOwner);
  const cancelInvitation = useMutation(api.platform.adminOrganizations.cancelInvitation);
  const remove = useMutation(api.platform.adminOrganizations.remove);

  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [typedName, setTypedName] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    setConfirm(null);
    setDeleting(false);
    setTypedName("");
  }, [organizationId]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setPending(true);
    try {
      await action();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(organizationErrorMessage(error));
      return false;
    } finally {
      setPending(false);
      setConfirm(null);
    }
  };

  const ownerCount = organization?.members.filter((member) => member.role === "owner").length ?? 0;

  const onConfirm = () => {
    if (!organizationId || !confirm) return;
    if (confirm.kind === "addOwner") {
      void run(() => addOwner({ organizationId, userId: confirm.userId }), `${confirm.email} is now an owner`);
    } else if (confirm.kind === "removeOwner") {
      void run(() => removeOwner({ organizationId, userId: confirm.userId, role: "admin" }), `${confirm.email} is now an admin`);
    } else {
      void run(() => cancelInvitation({ invitationId: confirm.invitationId }), `Invitation to ${confirm.email} canceled`);
    }
  };

  const confirmText = (c: Confirm) => {
    if (c.kind === "addOwner") {
      return { title: "Make owner", label: "Make owner", description: `${c.email} will be able to manage and delete this organization, alongside its current owners.` };
    }
    if (c.kind === "removeOwner") {
      return { title: "Remove as owner", label: "Make admin", description: `${c.email} stays a member, as an admin. The organization keeps its other owners.` };
    }
    return { title: "Cancel invitation", label: "Cancel invitation", description: `The invitation link sent to ${c.email} will stop working.` };
  };

  const deleteOrganization = async () => {
    if (!organizationId || !organization) return;
    const ok = await run(() => remove({ organizationId }), `${organization.name} deleted`);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={organizationId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{organization?.name ?? "Organization"}</DialogTitle>
          <DialogDescription>
            {organization
              ? `Created ${formatDate(organization.createdAt)} · ${organization.memberCount} member${organization.memberCount === 1 ? "" : "s"}`
              : "Loading..."}
          </DialogDescription>
        </DialogHeader>

        {organization === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : organization === null ? (
          <p className="text-sm text-muted-foreground">Sign in again to view this organization.</p>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Members</h3>
              <p className="text-xs text-muted-foreground">
                Every organization with members always has at least one owner. To transfer ownership, make another
                member an owner, then remove the previous owner.
              </p>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organization.members.map((member) => {
                      const onlyOwner = member.role === "owner" && ownerCount <= 1;
                      return (
                        <TableRow key={member.memberId} data-testid="organization-member">
                          <TableCell>
                            <div className="font-medium">{member.name || member.email}</div>
                            <div className="text-xs text-muted-foreground">{member.email}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={member.role === "member" ? "secondary" : "default"}>{member.role}</Badge>
                            {member.banned && <Badge variant="destructive" className="ms-1">Banned</Badge>}
                          </TableCell>
                          <TableCell>{formatDate(member.joinedAt)}</TableCell>
                          <TableCell className="text-right">
                            {member.role === "owner" ? (
                              onlyOwner ? (
                                <span className="text-xs text-muted-foreground">Only owner</span>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() => setConfirm({ kind: "removeOwner", userId: member.userId, email: member.email })}
                                >
                                  Remove as owner
                                </Button>
                              )
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={pending}
                                onClick={() => setConfirm({ kind: "addOwner", userId: member.userId, email: member.email })}
                              >
                                Make owner
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Invitations</h3>
              {organization.invitations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending, expired or recently declined invitations.</p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {organization.invitations.map((invitation) => (
                        <TableRow key={invitation.id}>
                          <TableCell>{invitation.email}</TableCell>
                          <TableCell>{invitation.role}</TableCell>
                          <TableCell><Badge variant="secondary">{invitation.status}</Badge></TableCell>
                          <TableCell>{formatDate(invitation.sentAt)}</TableCell>
                          <TableCell className="text-right">
                            {invitation.status === "pending" && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={pending}
                                onClick={() => setConfirm({ kind: "cancelInvitation", invitationId: invitation.id, email: invitation.email })}
                              >
                                Cancel
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-md border border-destructive/40 p-4">
              <h3 className="text-sm font-medium text-destructive">Delete organization</h3>
              <p className="text-sm text-muted-foreground">
                Removes its memberships, invitations and all of its app data permanently. Member accounts are kept;
                they continue in their other organizations, or with none.
              </p>
              {!deleting ? (
                <Button variant="destructive" size="sm" onClick={() => setDeleting(true)}>Delete organization</Button>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="confirm-organization-name">Type <strong>{organization.name}</strong> to confirm</Label>
                  <Input
                    id="confirm-organization-name"
                    autoComplete="off"
                    value={typedName}
                    onChange={(event) => setTypedName(event.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setDeleting(false); setTypedName(""); }}>Cancel</Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={pending || typedName !== organization.name}
                      onClick={() => void deleteOrganization()}
                    >
                      {pending ? "Deleting..." : "Delete permanently"}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {confirm && (
          <ConfirmationDialog
            open
            onOpenChange={(open) => { if (!open) setConfirm(null); }}
            title={confirmText(confirm).title}
            description={confirmText(confirm).description}
            confirmLabel={confirmText(confirm).label}
            pending={pending}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
