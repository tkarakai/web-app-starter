"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useConvexAuth, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  toast,
} from "@web-app-starter/design-system";

import { organizationErrorKey } from "../lib/organization";
import { useSignOut } from "../lib/use-sign-out";

function Panel({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5" data-testid="accept-invitation">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-2 sm:flex-row">{children}</CardContent>}
    </Card>
  );
}

/**
 * The page an invitation email links to. Signed out: sign in or create an account (the
 * invitation then waits on the dashboard). Signed in: accept or decline, or the reason
 * this account can't (another address, unverified email, expired or used invitation).
 */
export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const t = useTranslations("organization.invitation");
  const te = useTranslations("organization.errors");
  const tr = useTranslations("organization.roles");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale();
  const signOut = useSignOut(`/${locale}/accept-invitation/${encodeURIComponent(invitationId)}`);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const invitation = useQuery(api.platform.organizations.invitation, isAuthenticated ? { id: invitationId } : "skip");
  const [pending, setPending] = React.useState(false);

  if (isLoading || (isAuthenticated && invitation === undefined)) {
    return <Skeleton className="h-48 w-full max-w-md" />;
  }

  if (!isAuthenticated) {
    return (
      <Panel title={t("signedOutTitle")} description={t("signedOutDescription")}>
        <Button asChild className="flex-1"><a href={`/${locale}/sign-in`}>{t("signIn")}</a></Button>
        <Button asChild variant="outline" className="flex-1">
          <a href={`/${locale}/sign-up?invitation=${encodeURIComponent(invitationId)}`}>{t("signUp")}</a>
        </Button>
      </Panel>
    );
  }

  const dashboard = <Button asChild className="flex-1"><a href={`/${locale}/dashboard`}>{t("openDashboard")}</a></Button>;
  if (!invitation) return <Panel title={t("notFoundTitle")} description={t("notFoundDescription")}>{dashboard}</Panel>;
  if (invitation.alreadyMember) {
    return (
      <Panel title={t("alreadyMemberTitle", { organization: invitation.organizationName })} description={t("alreadyMemberDescription")}>
        {dashboard}
      </Panel>
    );
  }
  if (invitation.status !== "pending") return <Panel title={t("usedTitle")} description={t("usedDescription")}>{dashboard}</Panel>;
  if (invitation.expired) {
    return <Panel title={t("expiredTitle")} description={t("expiredDescription", { inviter: invitation.inviterName })}>{dashboard}</Panel>;
  }
  if (!invitation.isRecipient) {
    return (
      <Panel title={t("wrongAccountTitle")} description={t("wrongAccountDescription", { email: invitation.email, current: invitation.signedInAs })}>
        <Button className="flex-1" onClick={() => void signOut()}>{tc("signOut")}</Button>
      </Panel>
    );
  }
  if (!invitation.emailVerified) {
    return (
      <Panel title={t("verifyTitle")} description={t("verifyDescription", { organization: invitation.organizationName, email: invitation.email })}>
        <Button asChild className="flex-1">
          <a href={`/${locale}/verify-email?email=${encodeURIComponent(invitation.email)}`}>{t("verify")}</a>
        </Button>
      </Panel>
    );
  }

  const respond = async (accept: boolean) => {
    setPending(true);
    try {
      const result = accept
        ? await authClient.organization.acceptInvitation({ invitationId })
        : await authClient.organization.rejectInvitation({ invitationId });
      if (result.error) {
        toast.error(te(organizationErrorKey(result.error)));
        return;
      }
      if (!accept) toast.success(t("declined"));
      // Accepting makes the organization active; the dashboard opens in it.
      router.push(`/${locale}/dashboard`);
    } catch {
      toast.error(te("generic"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title={t("title", { organization: invitation.organizationName })}
      description={t("description", {
        inviter: invitation.inviterName,
        organization: invitation.organizationName,
        role: tr(invitation.role),
      })}
    >
      <Button className="flex-1" disabled={pending} onClick={() => void respond(true)}>
        {pending ? t("accepting") : t("accept")}
      </Button>
      <Button variant="outline" className="flex-1" disabled={pending} onClick={() => void respond(false)}>
        {t("decline")}
      </Button>
    </Panel>
  );
}
