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

import { organizationErrorKey, rememberInvitation, takeRememberedInvitation } from "../lib/organization";
import { useSignOut } from "../lib/use-sign-out";
import { SendVerificationButton } from "./organization-invitations";

function Panel({ title, description, state, children }: {
  title: string;
  description: string;
  state: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5" data-testid="accept-invitation" data-state={state}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-2 sm:flex-row">{children}</CardContent>}
    </Card>
  );
}

/**
 * The page an invitation email links to. Signed out, it reveals nothing about the invitation:
 * sign in or create an account, and the user is brought back here afterwards. Signed in, it
 * shows what the backend decided: accept or decline, verify the email first, finish security
 * setup, already a member, meant for another account, or no longer valid.
 */
export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const t = useTranslations("organization.invitation");
  const te = useTranslations("organization.errors");
  const tr = useTranslations("organization.roles");
  const router = useRouter();
  const locale = useLocale();
  const here = `/${locale}/accept-invitation/${encodeURIComponent(invitationId)}`;
  const signOut = useSignOut(here);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const invitation = useQuery(api.platform.organizations.invitation, isAuthenticated ? { id: invitationId } : "skip");
  const [pending, setPending] = React.useState(false);

  // Signed out: come back here after signing in or up. Signed in: this page is the answer.
  React.useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) takeRememberedInvitation();
    else rememberInvitation(invitationId);
  }, [isAuthenticated, isLoading, invitationId]);

  if (isLoading || (isAuthenticated && invitation === undefined)) {
    return <Skeleton className="h-48 w-full max-w-md" />;
  }

  if (!isAuthenticated || !invitation) {
    return (
      <Panel title={t("signedOutTitle")} description={t("signedOutDescription")} state="signedOut">
        <Button asChild className="flex-1"><a href={`/${locale}/sign-in`}>{t("signIn")}</a></Button>
        <Button asChild variant="outline" className="flex-1">
          <a href={`/${locale}/sign-up?invitation=${encodeURIComponent(invitationId)}`}>{t("signUp")}</a>
        </Button>
      </Panel>
    );
  }

  const dashboard = (
    <Button asChild variant="outline" className="flex-1"><a href={`/${locale}/dashboard`}>{t("openDashboard")}</a></Button>
  );

  switch (invitation.state) {
    case "invalid":
      return <Panel title={t("invalidTitle")} description={t("invalidDescription")} state="invalid">{dashboard}</Panel>;
    case "wrongAccount":
      return (
        <Panel title={t("wrongAccountTitle")} description={t("wrongAccountDescription", { current: invitation.signedInAs })} state="wrongAccount">
          <Button className="flex-1" onClick={() => void signOut()}>{t("switchAccount")}</Button>
          {dashboard}
        </Panel>
      );
    case "member":
      return (
        <Panel
          title={t("alreadyMemberTitle", { organization: invitation.organizationName })}
          description={t("alreadyMemberDescription")}
          state="member"
        >
          <Button
            className="flex-1"
            onClick={() => void authClient.organization.setActive({ organizationId: invitation.organizationId })
              .finally(() => router.push(`/${locale}/dashboard`))}
          >
            {t("openOrganization", { organization: invitation.organizationName })}
          </Button>
        </Panel>
      );
    case "verify":
      return (
        <Panel
          title={t("verifyTitle")}
          description={t("verifyDescription", { organization: invitation.organizationName, email: invitation.email })}
          state="verify"
        >
          <SendVerificationButton email={invitation.email} callbackURL={here} className="flex-1">{t("verify")}</SendVerificationButton>
        </Panel>
      );
    case "security":
      return (
        <Panel
          title={t("securityTitle")}
          description={t("securityDescription", { organization: invitation.organizationName })}
          state="security"
        >
          <Button asChild className="flex-1">
            {/* The dashboard asks for the missing step, then brings the user back here. */}
            <a href={`/${locale}/dashboard`} onClick={() => rememberInvitation(invitationId)}>{t("continueSetup")}</a>
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
      toast.success(accept ? t("joined", { organization: invitation.organizationName }) : t("declined"));
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
      state="open"
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

/**
 * After sign-in or sign-up, return to an invitation link opened while signed out, once the
 * session may act (email verified, security setup done). Put it in the protected layout.
 * Renders nothing.
 */
export function ResumeInvitation() {
  const status = useQuery(api.platform.sessionAssurance.status, {});
  const router = useRouter();
  const locale = useLocale();
  const allowed = status?.allowed === true;

  React.useEffect(() => {
    if (!allowed) return;
    const id = takeRememberedInvitation();
    if (id) router.replace(`/${locale}/accept-invitation/${encodeURIComponent(id)}`);
  }, [allowed, locale, router]);

  return null;
}
