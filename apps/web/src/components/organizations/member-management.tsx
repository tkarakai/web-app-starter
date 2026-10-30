"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "@repo/backend";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@web-app-starter/design-system";
import { useSafeQuery } from "@/hooks/use-safe-query";
import { usePersonalDataContext } from "@/hooks/use-personal-data";
import { usePersonalDispatch } from "@/hooks/use-personal-dispatch";
import { OrganizationConfirmation } from "./organization-confirmation";
import { OrganizationFeedback } from "./organization-feedback";

interface MemberRow { memberId: string; name: string; email: string; role: string; adminPending: boolean; enrolled: boolean; isContact?: boolean }
interface InvitationRow { invitationId: string; email: string; role: string; status: string; deliveryState: string }
interface MembershipEvent { id: string; happenedAt: number; action: string }
const eventLabels: Record<string, string> = {
  "invitation.issued": "invite", "invitation.canceled": "canceled", "invitation.resent": "resend", "invitation.accepted": "accepted",
  "admin.enrollment_completed": "enrollment", "member.promotion_started": "promote", "member.demote": "demote",
  "member.remove": "remove", "member.left": "leave", "contact.changed": "setContact",
};
type Change = { memberId: string; operation: "remove" | "demote" | "promote" };
export function MemberManagement({ organizationId }: { organizationId: string }) {
  const t = useTranslations("organizations"); const format = useFormatter();
  const [memberCursors, setMemberCursors] = useState<Array<string | null>>([null]);
  const [inviteCursors, setInviteCursors] = useState<Array<string | null>>([null]);
  const members = useSafeQuery(api.platform.memberManagement.directory, { organizationId, paginationOpts: { cursor: memberCursors.at(-1) ?? null, numItems: 25 } });
  const invites = useSafeQuery(api.platform.memberInvitations.list, { organizationId, paginationOpts: { cursor: inviteCursors.at(-1) ?? null, numItems: 25 } });
  const history = useSafeQuery(api.platform.memberManagement.audit, { organizationId });
  const issue = useAction(api.platform.memberInvitations.issue); const resend = useAction(api.platform.memberInvitations.resend);
  const cancel = useMutation(api.platform.memberInvitations.cancel); const change = useMutation(api.platform.memberManagement.change);
  const contact = useMutation(api.platform.memberManagement.setContact);
  const context = usePersonalDataContext(); const capture = usePersonalDispatch(context, context.tenant ?? undefined, organizationId);
  const [email, setEmail] = useState(""); const [role, setRole] = useState<"member" | "org-admin">("member");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [message, setMessage] = useState(false);
  const [confirmation, setConfirmation] = useState<Change | null>(null);
  const run = async (call: () => Promise<unknown>) => {
    setBusy(true); setError(null); setMessage(false);
    try { await capture().dispatch(call); setMessage(true); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  if (members.error || invites.error) return <OrganizationFeedback error={members.error ?? invites.error} onRetry={() => window.location.reload()} />;
  return <div className="space-y-6" data-agent-sensitive>
    <p className="rounded-lg border bg-muted/30 p-4 text-sm">{t("privateNotice")}</p>
    {Boolean(error) && !confirmation && <OrganizationFeedback error={error} />}{message && <p role="status" className="text-sm">{t("saved")}</p>}
    <Card><CardHeader><CardTitle>{t("invite")}</CardTitle></CardHeader><CardContent>
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void run(async () => { await issue({ organizationId, email: email.trim(), role }); setEmail(""); }); }}>
        <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="member-email">{t("email")}</Label><Input id="member-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
        <div className="space-y-2"><Label htmlFor="member-role">{t("role")}</Label><select id="member-role" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={role} onChange={event => setRole(event.target.value === "org-admin" ? "org-admin" : "member")}><option value="member">{t("member")}</option><option value="org-admin">{t("admin")}</option></select></div>
        <Button type="submit" disabled={busy}>{t("sendInvitation")}</Button>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">{t("deliveryHelp")}</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{t("members")}</CardTitle></CardHeader><CardContent className="space-y-3">
      {members.data === undefined ? <p role="status">{t("loading")}</p> : members.data.page.map((member: MemberRow) => <div key={member.memberId} data-member-id={member.memberId} className="flex min-w-0 flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{member.name}</p><p className="break-all text-sm text-muted-foreground">{member.email}</p><p className="text-xs">{t(member.role === "org-admin" ? "admin" : "member")}{member.adminPending ? ` · ${t("pending")}` : ""}{"isContact" in member && member.isContact ? ` · ${t("currentContact")}` : ""}</p></div>
        <div className="flex flex-wrap gap-2">
          {member.enrolled && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => contact({ organizationId, memberId: member.memberId }))}>{t("setContact")}</Button>}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmation({ memberId: member.memberId, operation: member.role === "org-admin" || member.adminPending ? "demote" : "promote" })}>{t(member.role === "org-admin" || member.adminPending ? "demote" : "promote")}</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmation({ memberId: member.memberId, operation: "remove" })}>{t("remove")}</Button>
        </div>
      </div>)}
      <OrganizationConfirmation open={Boolean(confirmation)} title={t("confirmChange")} description={t("preserveOnRemove")} busy={busy} error={error} onOpenChange={open => { if (!open) setConfirmation(null); }} onConfirm={() => { if (confirmation) void run(async () => { await change({ organizationId, ...confirmation }); setConfirmation(null); }); }}>
        {confirmation && <p className="break-all text-sm font-medium">{members.data?.page.find((member: MemberRow) => member.memberId === confirmation.memberId)?.email}</p>}
      </OrganizationConfirmation>
      <div className="flex gap-2"><Button variant="outline" disabled={memberCursors.length < 2} onClick={() => setMemberCursors(items => items.slice(0, -1))}>{t("previous")}</Button><Button variant="outline" disabled={!members.data || members.data.isDone} onClick={() => { if (members.data && !members.data.isDone) setMemberCursors(items => [...items, members.data!.continueCursor]); }}>{t("next")}</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{t("invitations")}</CardTitle></CardHeader><CardContent className="space-y-3">
      {invites.data === undefined ? <p role="status">{t("loading")}</p> : invites.data.page.length === 0 ? <p className="text-sm text-muted-foreground">{t("noInvitations")}</p> : invites.data.page.map((invite: InvitationRow) => <div key={invite.invitationId} data-invitation-id={invite.invitationId} className="flex min-w-0 flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{invite.email}</p><p className="text-xs text-muted-foreground">{t(invite.role === "org-admin" ? "admin" : "member")} · {t(invite.status === "accepted" ? "accepted" : invite.status === "expired" ? "expired" : invite.status === "canceled" ? "canceled" : "pending")} · {t(invite.deliveryState === "sent" ? "delivered" : invite.deliveryState === "failed" ? "deliveryFailed" : "deliveryPending")}</p></div>
        {(invite.status === "pending" || invite.status === "expired") && <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => resend({ organizationId, invitationId: invite.invitationId }))}>{t("resend")}</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => cancel({ organizationId, invitationId: invite.invitationId }))}>{t("cancel")}</Button></div>}
      </div>)}
      <div className="flex gap-2"><Button variant="outline" disabled={inviteCursors.length < 2} onClick={() => setInviteCursors(items => items.slice(0, -1))}>{t("previous")}</Button><Button variant="outline" disabled={!invites.data || invites.data.isDone} onClick={() => { if (invites.data && !invites.data.isDone) setInviteCursors(items => [...items, invites.data!.continueCursor]); }}>{t("next")}</Button></div>
    </CardContent></Card>
    <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">{t("history")}</summary>{history.error ? <OrganizationFeedback error={history.error} /> : <ul className="mt-3 space-y-2 text-sm">{history.data?.map((event: MembershipEvent) => <li key={event.id}>{format.dateTime(event.happenedAt, { dateStyle: "medium", timeStyle: "short" })} · {t(eventLabels[event.action] ?? "membershipChanged")}</li>)}</ul>}</details>
  </div>;
}
