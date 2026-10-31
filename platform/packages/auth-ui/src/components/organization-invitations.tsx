"use client";

import * as React from "react";
import { Building2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { authClient, isAuthRateLimited } from "@web-app-starter/auth/client";
import { Alert, AlertDescription, Button, toast } from "@web-app-starter/design-system";

import { organizationErrorKey, takeExpectedDeparture, useOrganizations } from "../lib/organization";

/**
 * Invitations waiting for the signed-in user's address, with Accept and Decline. Put it at
 * the top of the dashboard: an invited person who signs in or signs up lands there.
 */
export function OrganizationInvitations({ onAccepted }: { onAccepted?: () => void }) {
  const t = useTranslations("organization");
  const locale = useLocale();
  const invitations = useQuery(api.platform.organizations.myInvitations);
  const [pending, setPending] = React.useState<string | null>(null);

  if (!invitations || invitations.length === 0) return null;

  const respond = async (id: string, organization: string, accept: boolean) => {
    setPending(id);
    try {
      if (accept) onAccepted?.();
      const result = accept
        ? await authClient.organization.acceptInvitation({ invitationId: id })
        : await authClient.organization.rejectInvitation({ invitationId: id });
      if (result.error) toast.error(t(`errors.${organizationErrorKey(result.error)}`));
      else if (accept) toast.success(t("banner.joined", { organization }));
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2" data-testid="organization-invitations-banner">
      {invitations.map((invitation) => (
        <Alert key={invitation.id} className="flex flex-wrap items-center gap-3">
          <Building2 className="h-4 w-4" />
          <AlertDescription className="flex-1 text-sm text-foreground">
            {t("banner.message", { inviter: invitation.inviterName, organization: invitation.organizationName })}
            {!invitation.emailVerified && (
              <span className="block text-xs text-muted-foreground">{t("banner.verifyFirst")}</span>
            )}
          </AlertDescription>
          <div className="flex gap-2">
            {invitation.emailVerified ? (
              <Button
                size="sm"
                disabled={pending !== null}
                onClick={() => void respond(invitation.id, invitation.organizationName, true)}
              >
                {t("banner.accept")}
              </Button>
            ) : (
              <SendVerificationButton email={invitation.email} callbackURL={`/${locale}/dashboard`} size="sm">
                {t("banner.verify")}
              </SendVerificationButton>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => void respond(invitation.id, invitation.organizationName, false)}
            >
              {t("banner.decline")}
            </Button>
          </div>
        </Alert>
      ))}
    </div>
  );
}

/**
 * Sends the signed-in user a verification email in place. Accepting an invitation needs a
 * verified address, and this works whatever the email-verification policy is.
 */
export function SendVerificationButton({ email, callbackURL, size, className, children }: {
  email: string;
  /** Where the link in the email returns to once verified. */
  callbackURL: string;
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("auth");
  const [sending, setSending] = React.useState(false);
  const send = async () => {
    setSending(true);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL });
      if (result.error) {
        toast.error(isAuthRateLimited(result.error) ? t("errors.rateLimited") : t("verifyEmail.verificationErrorUnknown"));
      } else {
        toast.success(t("verifyEmail.resent"));
      }
    } catch {
      toast.error(t("verifyEmail.verificationErrorUnknown"));
    } finally {
      setSending(false);
    }
  };
  return (
    <Button size={size} className={className} disabled={sending} onClick={() => void send()}>
      {children}
    </Button>
  );
}

/**
 * Keeps a signed-in user's organizations in order. Gives one who belongs to no organization a
 * personal one: after an upgrade, before the data migration reaches them, or after leaving or
 * deleting their last one. Tells them when an organization disappears from their list without
 * their doing (they were removed, or an owner deleted it). Renders nothing.
 */
export function EnsureOrganization() {
  const t = useTranslations("organization");
  const organizations = useOrganizations();
  const ensure = useMutation(api.platform.organizations.ensure);
  const requested = React.useRef(false);
  const known = React.useRef<Map<string, string> | null>(null);

  React.useEffect(() => {
    if (!organizations) return;
    const current = new Map<string, string>(organizations.organizations.map((organization) => [organization.id, organization.name]));
    for (const [id, name] of known.current ?? []) {
      if (!current.has(id) && !takeExpectedDeparture(id)) toast.info(t("access.lost", { organization: name }));
    }
    known.current = current;

    if (current.size > 0) {
      requested.current = false;
      return;
    }
    if (requested.current) return;
    requested.current = true;
    void ensure({}).catch(() => { requested.current = false; });
  }, [organizations, ensure, t]);

  return null;
}
