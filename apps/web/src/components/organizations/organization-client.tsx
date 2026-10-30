"use client";

import { Activity, useEffect, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { authClient } from "@web-app-starter/auth/client";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@web-app-starter/i18n/navigation";
import { api } from "@repo/backend";
import { useAuthUser } from "@web-app-starter/auth-ui";
import { BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator, Button, SidebarInset, SidebarProvider } from "@web-app-starter/design-system";
import { Breadcrumb, SidebarTrigger } from "@/components/ui/localized-controls";
import { AnnouncementBannerHost } from "@/components/announcement-banner-host";
import { AppSidebar } from "@/components/projects/app-sidebar";
import { useOrganizationSnapshot, usePersonalDataContext } from "@/hooks/use-personal-data";
import { useOrganizationSelection } from "@/hooks/organization-selection";
import { useSafeQuery } from "@/hooks/use-safe-query";
import { usePersonalDispatch } from "@/hooks/use-personal-dispatch";
import { OrganizationConfirmation } from "./organization-confirmation";
import { OrganizationFeedback } from "./organization-feedback";
import { OrganizationPicker } from "./organization-picker";
import { EnrollmentPanel } from "./enrollment-panel";
import { MemberManagement } from "./member-management";
import { OrganizationStepUp } from "./organization-step-up";

type Workspace = {
  userId: string;
  organizationId: string;
  own: NonNullable<FunctionReturnType<typeof api.platform.tenantContext.mine>>["contexts"][number];
  detail: NonNullable<FunctionReturnType<typeof api.platform.tenantContext.get>>;
};

function OrganizationWorkspace({ workspace }: { workspace: Workspace }) {
  const { organizationId, own, detail } = workspace;
  const t = useTranslations("organizations");
  const context = usePersonalDataContext();
  const leave = useMutation(api.platform.memberManagement.leave);
  const capture = usePersonalDispatch(context, context.tenant ?? undefined, organizationId);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <div data-organization-id={organizationId} className="space-y-6">
    <h2 className="text-lg font-medium">{own.name}</h2>
    {detail.canManageMembers ? <MemberManagement organizationId={organizationId} />
      : own.personal && own.experience === "personal" || detail.enrollmentPending
        ? <EnrollmentPanel organizationId={organizationId} personal={own.personal} started={detail.enrollmentStarted} />
        : <p className="rounded-lg border p-4 text-sm">{t("memberAccess")}</p>}
    {own.experience !== "personal" && <div className="border-t pt-4"><Button variant="outline" onClick={() => setConfirmLeave(true)}>{t("leave")}</Button>
      <OrganizationConfirmation open={confirmLeave} title={t("leave")} description={t("leaveWarning")} busy={busy} error={error} onOpenChange={setConfirmLeave} onConfirm={() => { void (async () => {
        setBusy(true); setError(null);
        try { await capture().dispatch(() => leave({ organizationId })); setConfirmLeave(false); }
        catch (failure) { setError(failure); } finally { setBusy(false); }
      })(); }} />
    </div>}
  </div>;
}

export function OrganizationContent() {
  const t = useTranslations("organizations"); const router = useRouter();
  const snapshot = useOrganizationSnapshot(); const session = authClient.useSession();
  const selected = useOrganizationSelection(snapshot.userId ?? session.data?.user.id ?? null);
  const organizationId = selected ?? (snapshot.mine?.contexts.length === 1 ? snapshot.mine.contexts[0]?.organizationId : undefined);
  const own = snapshot.mine?.contexts.find(item => item.organizationId === organizationId);
  const detail = useSafeQuery(api.platform.tenantContext.get, own?.lifecycle === "active" && organizationId ? { organizationId } : "skip");
  const [retained, setRetained] = useState<Workspace | null>(null);
  useEffect(() => {
    if (snapshot.userId && organizationId && own && detail.data) {
      setRetained(detail.data.canManageMembers ? null : { userId: snapshot.userId, organizationId, own, detail: detail.data });
    }
  }, [snapshot.userId, organizationId, own, detail.data]);
  const current = snapshot.userId && organizationId && own?.lifecycle === "active" && detail.data
    ? { userId: snapshot.userId, organizationId, own, detail: detail.data } : null;
  // Token rotation may temporarily withdraw discovery. Preserve the same mounted
  // ceremony, hidden, so one-time recovery codes survive. Never retain member
  // directories or a ceremony after a definitive denial/withdrawn membership.
  const transient = !snapshot.error && !detail.error && (snapshot.mine == null || (own?.lifecycle === "active" && detail.data === undefined));
  const workspace = current ?? (transient && retained && retained.userId === session.data?.user.id && (organizationId === undefined || retained.organizationId === organizationId) ? retained : null);
  const loading = snapshot.mine === undefined || (own?.lifecycle === "active" && detail.data === undefined);
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("privateNotice")}</p></div>
    <OrganizationPicker /><OrganizationStepUp />
    <Activity mode={current ? "visible" : "hidden"}>
      {workspace && <OrganizationWorkspace key={`${workspace.userId}:${workspace.organizationId}`} workspace={workspace} />}
    </Activity>
    {snapshot.error || detail.error ? <OrganizationFeedback error={snapshot.error ?? detail.error} onRetry={() => window.location.reload()} />
      : loading ? <p role="status">{t("loading")}</p>
      : !current && <div className="space-y-4 rounded-lg border p-5"><p role="status">{snapshot.mine?.contexts.length ? t("chooseAvailable") : t("noMembership")}</p><Button variant="outline" onClick={() => router.push("/dashboard/settings?tab=security")}>{t("security")}</Button><Button variant="ghost" onClick={() => window.location.reload()}>{t("retry")}</Button></div>}
  </div>;
}

export function OrganizationClient() {
  const t = useTranslations("organizations"); const tc = useTranslations("common"); const td = useTranslations("dashboard"); const router = useRouter(); const user = useAuthUser();
  return <SidebarProvider><AppSidebar displayName={user?.name ?? tc("anonymous")} displayEmail={user?.email} selectedProjectId={null} onSelectProject={() => router.push("/dashboard")} /><SidebarInset className="flex h-dvh flex-col"><AnnouncementBannerHost className="shrink-0" /><header className="flex h-14 shrink-0 items-center gap-3 border-b px-4"><SidebarTrigger /><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/dashboard">{td("projects")}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{t("title")}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></header><div className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-4xl p-4 sm:p-8"><OrganizationContent /></div></div></SidebarInset></SidebarProvider>;
}
