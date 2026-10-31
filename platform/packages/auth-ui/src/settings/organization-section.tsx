"use client";

import * as React from "react";
import { Building2, LogOut, Mail, RotateCw, Trash2, UserMinus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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

import { SessionAccessGate } from "../components/session-access-gate";
import { NoOrganization } from "../components/no-organization";
import { expectOrganizationDeparture, organizationErrorKey, takeExpectedDeparture, useOrganizations, type OrganizationRole } from "../lib/organization";

type Result = { error?: { status?: number; code?: string } | null };

/**
 * The active organization's page: its name, members and roles, invitations, and for owners
 * the danger zone. Every member sees it; owners and admins get the controls. Better Auth
 * checks every change server-side, whatever this UI shows.
 */
export function OrganizationSection() {
  const t = useTranslations("organization");
  const organization = useQuery(api.platform.organizations.active);
  const mine = useOrganizations();

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
  if (!mine) return null;
  if (!organization) return <NoOrganization />;

  const canManage = organization.role !== "member";
  const roleLabel = (role: OrganizationRole) => t(`roles.${role}`);
  const onlyOne = mine.organizations.length < 2;

  return (
    <div className="space-y-6" data-testid="organization-settings">
      <NameCard organization={organization} canManage={canManage} run={run} roleLabel={roleLabel} />
      <MembersCard organization={organization} run={run} roleLabel={roleLabel} />
      {canManage && <InvitationsCard organization={organization} run={run} roleLabel={roleLabel} />}
      {organization.role === "owner" && <DangerZoneCard organization={organization} run={run} onlyOne={onlyOne} />}
    </div>
  );
}

type ActiveOrganization = NonNullable<ReturnType<typeof useQuery<typeof api.platform.organizations.active>>>;
type Run = (call: () => Promise<Result>, success?: string) => Promise<boolean>;
type CardProps = {
  organization: ActiveOrganization;
  run: Run;
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
          <form className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end sm:gap-3" onSubmit={save}>
            <div className="grid gap-2">
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
  // The last owner can't leave (Better Auth refuses): they promote someone or delete instead.
  const lastOwner = youAreOwner && organization.members.filter((member) => member.role === "owner").length === 1;

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
            const name = member.name || member.email;
            return (
              <li key={member.memberId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {name}
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
                      t("settings.roleChanged", { name, role: roleLabel(role as OrganizationRole) }),
                    )}
                  >
                    <SelectTrigger className="w-32" aria-label={t("settings.changeRole", { name })}>
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
                      <Button variant="ghost" size="icon" aria-label={t("settings.removeLabel", { name })}>
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("settings.removeTitle", { name })}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("settings.removeDescription", { name, organization: organization.name })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void run(
                            () => authClient.organization.removeMember({ organizationId: organization.id, memberIdOrEmail: member.memberId }),
                            t("settings.removed", { name }),
                          )}
                        >
                          {t("settings.remove")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {member.isYou && !lastOwner && <LeaveButton organization={organization} run={run} />}
                {member.isYou && lastOwner && <p className="w-full text-sm text-muted-foreground">{t("leave.lastOwner")}</p>}
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
        <div className="grid gap-2">
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end" onSubmit={invite}>
            <div className="grid gap-2">
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
            <div className="grid gap-2">
              <Label htmlFor="invite-role">{t("invite.role")}</Label>
              <Select value={role} onValueChange={(value) => setRole(value as OrganizationRole)}>
                <SelectTrigger id="invite-role">
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
        </div>

        {organization.invitations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("pending.title")}</h3>
            <ul className="divide-y divide-border/60 rounded-md border border-border/60" data-testid="organization-invitations">
              {organization.invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-3 py-2" data-status={invitation.status}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {roleLabel(invitation.role)} · {t("pending.sent", { date: format.dateTime(invitation.sentAt, { dateStyle: "medium" }) })}
                      {invitation.status === "pending" && (
                        <> · {t("pending.expires", { date: format.dateTime(invitation.expiresAt, { dateStyle: "medium" }) })}</>
                      )}
                    </p>
                  </div>
                  {invitation.status !== "pending" && (
                    <Badge variant={invitation.status === "declined" ? "outline" : "secondary"}>
                      {t(`pending.${invitation.status}`)}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void run(
                      // A declined invitation is final; inviting again sends a new one.
                      () => authClient.organization.inviteMember({
                        organizationId: organization.id, email: invitation.email, role: invitation.role,
                        resend: invitation.status !== "declined",
                      }),
                      t("pending.resent", { email: invitation.email }),
                    )}
                  >
                    <RotateCw className="me-1 h-3.5 w-3.5" />
                    {invitation.status === "declined" ? t("pending.inviteAgain") : t("pending.resend")}
                  </Button>
                  <DeleteInvitationButton email={invitation.email} invitationId={invitation.id} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Delete an invitation in any state, after confirming. A pending one's link stops working. */
function DeleteInvitationButton({ email, invitationId }: { email: string; invitationId: string }) {
  const t = useTranslations("organization");
  const tc = useTranslations("common");
  const deleteInvitation = useMutation(api.platform.organizations.deleteInvitation);
  const confirm = async () => {
    try {
      await deleteInvitation({ invitationId });
      toast.success(t("pending.deleted", { email }));
    } catch {
      toast.error(t("errors.generic"));
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("pending.deleteLabel", { email })}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pending.deleteTitle", { email })}</AlertDialogTitle>
          <AlertDialogDescription>{t("pending.deleteDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>{t("pending.delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LeaveButton({ organization, run }: { organization: ActiveOrganization; run: Run }) {
  const t = useTranslations("organization");
  const tc = useTranslations("common");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <LogOut className="me-1 h-3.5 w-3.5" />
          {t("leave.action")}
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
            onClick={() => {
              expectOrganizationDeparture(organization.id);
              void run(
                () => authClient.organization.leave({ organizationId: organization.id }),
                t("leave.left", { name: organization.name }),
              ).then((ok) => { if (!ok) takeExpectedDeparture(organization.id); });
            }}
          >
            {t("leave.action")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Owners only: delete the organization, after typing its name and confirming who they are. */
function DangerZoneCard({ organization, run, onlyOne }: { organization: ActiveOrganization; run: Run; onlyOne: boolean }) {
  const t = useTranslations("organization.danger");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const confirmId = React.useId();
  const matches = typed.trim() === organization.name.trim();

  const remove = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setDeleting(true);
    expectOrganizationDeparture(organization.id);
    const ok = await run(
      () => authClient.organization.delete({ organizationId: organization.id }),
      t("deleted", { name: organization.name }),
    );
    setDeleting(false);
    if (!ok) takeExpectedDeparture(organization.id);
    if (ok) {
      setOpen(false);
      router.push(`/${locale}/dashboard`);
    }
  };

  return (
    <Card className="border-destructive/40" data-testid="organization-danger-zone">
      <CardHeader>
        <CardTitle className="text-base text-destructive">{t("title")}</CardTitle>
        <CardDescription>{t("description", { name: organization.name })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => { setTyped(""); setOpen(true); }}>
          <Trash2 className="me-2 h-4 w-4" />
          {t("delete")}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent closeLabel={tc("close")}>
            <DialogHeader>
              <DialogTitle>{t("confirmTitle", { name: organization.name })}</DialogTitle>
              <DialogDescription>
                {t("confirmDescription", { name: organization.name })}
                {onlyOne && <> {t("onlyOrganization")}</>}
              </DialogDescription>
            </DialogHeader>
            {/* Deleting needs recent authentication; the gate asks for it first when needed. */}
            <SessionAccessGate requireRecent embedded>
              <form className="grid gap-4" onSubmit={remove}>
                <div className="grid gap-2">
                  <Label htmlFor={confirmId}>{t("confirmLabel", { name: organization.name })}</Label>
                  <Input id={confirmId} autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
                  <Button type="submit" variant="destructive" disabled={!matches || deleting}>
                    {deleting ? t("deleting") : t("confirm")}
                  </Button>
                </div>
              </form>
            </SessionAccessGate>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
