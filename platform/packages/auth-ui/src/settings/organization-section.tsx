"use client";

import * as React from "react";
import { Building2, LogOut, Mail, Plus, RotateCw, UserMinus, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "convex/react";

import { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@web-app-starter/design-system";

import { CreateOrganizationDialog } from "../components/create-organization-dialog";
import { organizationErrorKey, useOrganizations, type OrganizationRole } from "../lib/organization";

type Result = { error?: { status?: number; code?: string } | null };

/**
 * Settings for the active organization: its name, members and roles, invitations, and
 * leaving or creating an organization. Every member sees it; owners and admins get the
 * controls. Better Auth checks every change server-side, whatever this UI shows.
 */
export function OrganizationSection() {
  const t = useTranslations("organization");
  const organization = useQuery(api.platform.organizations.active);
  const mine = useOrganizations();
  const [createOpen, setCreateOpen] = React.useState(false);

  /** Run a Better Auth organization call with toast feedback; true on success. */
  const run = React.useCallback(async (call: () => Promise<Result>, success?: string) => {
    try {
      const result = await call();
      if (result.error) {
        toast.error(t(`errors.${organizationErrorKey(result.error)}`));
        return false;
      }
      if (success) toast.success(success);
      return true;
    } catch {
      toast.error(t("errors.generic"));
      return false;
    }
  }, [t]);

  if (organization === undefined || mine === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!organization || !mine) return null;

  const canManage = organization.role !== "member";
  const roleLabel = (role: OrganizationRole) => t(`roles.${role}`);

  return (
    <div className="space-y-6" data-testid="organization-settings">
      <NameCard organization={organization} canManage={canManage} run={run} roleLabel={roleLabel} />
      <MembersCard organization={organization} run={run} roleLabel={roleLabel} />
      {canManage && <InvitationsCard organization={organization} run={run} roleLabel={roleLabel} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("create.title")}</CardTitle>
          <CardDescription>{t("create.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="me-2 h-4 w-4" />
            {t("create.action")}
          </Button>
          <LeaveButton organization={organization} onlyOne={mine.organizations.length < 2} run={run} />
        </CardContent>
      </Card>
      <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

type ActiveOrganization = NonNullable<ReturnType<typeof useQuery<typeof api.platform.organizations.active>>>;
type CardProps = {
  organization: ActiveOrganization;
  run: (call: () => Promise<Result>, success?: string) => Promise<boolean>;
  roleLabel: (role: OrganizationRole) => string;
};

function NameCard({ organization, canManage, run, roleLabel }: CardProps & { canManage: boolean }) {
  const t = useTranslations("organization");
  const tc = useTranslations("common");
  const [name, setName] = React.useState(organization.name);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setName(organization.name), [organization.id, organization.name]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === organization.name) return;
    setSaving(true);
    await run(
      () => authClient.organization.update({ organizationId: organization.id, data: { name: trimmed } }),
      t("settings.renamed"),
    );
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{organization.name}</CardTitle>
            <CardDescription>
              {t("settings.yourRole", { role: roleLabel(organization.role) })} · {t("settings.memberCount", { count: organization.memberCount })}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("settings.description", { name: organization.name })}</p>
        {canManage && (
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={save}>
            <div className="flex-1 space-y-2">
              <Label htmlFor="organization-name">{t("settings.nameLabel")}</Label>
              <Input id="organization-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} required />
            </div>
            <Button type="submit" disabled={saving || !name.trim() || name.trim() === organization.name}>
              {saving ? tc("saving") : tc("save")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function MembersCard({ organization, run, roleLabel }: CardProps) {
  const t = useTranslations("organization");
  const tc = useTranslations("common");
  const format = useFormatter();
  const youAreOwner = organization.role === "owner";
  const canManage = organization.role !== "member";
  const roles: OrganizationRole[] = youAreOwner ? ["member", "admin", "owner"] : ["member", "admin"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("settings.members")}</CardTitle>
        <CardDescription>{t("settings.memberCount", { count: organization.memberCount })}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60" data-testid="organization-members">
          {organization.members.map((member) => {
            // Only owners may change or remove an owner; nobody manages themselves here.
            const manageable = canManage && !member.isYou && (youAreOwner || member.role !== "owner");
            return (
              <li key={member.memberId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name || member.email}
                    {member.isYou && <span className="ms-2 text-xs text-muted-foreground">({t("settings.you")})</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email} · {t("settings.joined", { date: format.dateTime(member.joinedAt, { dateStyle: "medium" }) })}
                  </p>
                </div>
                {manageable ? (
                  <Select
                    value={member.role}
                    onValueChange={(role) => void run(
                      () => authClient.organization.updateMemberRole({
                        organizationId: organization.id, memberId: member.memberId, role: role as OrganizationRole,
                      }),
                      t("settings.roleChanged", { name: member.name || member.email, role: roleLabel(role as OrganizationRole) }),
                    )}
                  >
                    <SelectTrigger className="w-32" aria-label={t("settings.changeRole", { name: member.name || member.email })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={member.role === "member" ? "secondary" : "default"}>{roleLabel(member.role)}</Badge>
                )}
                {manageable && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t("settings.removeTitle", { name: member.name || member.email })}>
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("settings.removeTitle", { name: member.name || member.email })}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("settings.removeDescription", { name: member.name || member.email, organization: organization.name })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void run(
                            () => authClient.organization.removeMember({ organizationId: organization.id, memberIdOrEmail: member.memberId }),
                            t("settings.removed", { name: member.name || member.email }),
                          )}
                        >
                          {t("settings.remove")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function InvitationsCard({ organization, run, roleLabel }: CardProps) {
  const t = useTranslations("organization");
  const format = useFormatter();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<OrganizationRole>("member");
  const [sending, setSending] = React.useState(false);
  const roles: OrganizationRole[] = organization.role === "owner" ? ["member", "admin", "owner"] : ["member", "admin"];

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    setSending(true);
    const ok = await run(
      () => authClient.organization.inviteMember({ organizationId: organization.id, email: address, role }),
      t("invite.sent", { email: address }),
    );
    setSending(false);
    if (ok) {
      setEmail("");
      setRole("member");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("invite.title")}</CardTitle>
        <CardDescription>{t("invite.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={invite}>
          <div className="flex-1 space-y-2">
            <Label htmlFor="invite-email">{t("invite.email")}</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              placeholder={t("invite.emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">{t("invite.role")}</Label>
            <Select value={role} onValueChange={(value) => setRole(value as OrganizationRole)}>
              <SelectTrigger id="invite-role" className="w-full sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((option) => <SelectItem key={option} value={option}>{roleLabel(option)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={sending || !email.trim()}>
            <Mail className="me-2 h-4 w-4" />
            {sending ? t("invite.sending") : t("invite.send")}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t(`roleHelp.${role}`)}</p>

        {organization.invitations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("pending.title")}</h3>
            <ul className="divide-y divide-border/60 rounded-md border border-border/60" data-testid="organization-invitations">
              {organization.invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {roleLabel(invitation.role)} · {invitation.expired
                        ? t("pending.expired")
                        : t("pending.expires", { date: format.dateTime(invitation.expiresAt, { dateStyle: "medium" }) })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void run(
                      () => authClient.organization.inviteMember({
                        organizationId: organization.id, email: invitation.email, role: invitation.role, resend: true,
                      }),
                      t("pending.resent", { email: invitation.email }),
                    )}
                  >
                    <RotateCw className="me-1 h-3.5 w-3.5" />
                    {t("pending.resend")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("pending.cancel")}
                    onClick={() => void run(
                      () => authClient.organization.cancelInvitation({ invitationId: invitation.id }),
                      t("pending.canceled", { email: invitation.email }),
                    )}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LeaveButton({ organization, onlyOne, run }: Omit<CardProps, "roleLabel"> & { onlyOne: boolean }) {
  const t = useTranslations("organization");
  const tc = useTranslations("common");

  if (onlyOne) {
    return <p className="self-center text-xs text-muted-foreground">{t("leave.onlyOrganization")}</p>;
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive hover:text-destructive">
          <LogOut className="me-2 h-4 w-4" />
          {t("leave.title")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("leave.confirmTitle", { name: organization.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("leave.description", { name: organization.name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void run(
              () => authClient.organization.leave({ organizationId: organization.id }),
              t("leave.left", { name: organization.name }),
            )}
          >
            {t("leave.action")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
