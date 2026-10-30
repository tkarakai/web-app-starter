"use client";

import * as React from "react";
import { Building2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";

import { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";
import { Alert, AlertDescription, Button, toast } from "@web-app-starter/design-system";

import { organizationErrorKey, useOrganizations } from "../lib/organization";

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
              <Button size="sm" asChild>
                <a href={`/${locale}/verify-email?email=${encodeURIComponent(invitation.email)}`}>{t("banner.verify")}</a>
              </Button>
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
 * Gives a signed-in user who belongs to no organization a personal one: after an upgrade,
 * before the data migration reaches them, or after leaving every organization. Renders nothing.
 */
export function EnsureOrganization() {
  const organizations = useOrganizations();
  const ensure = useMutation(api.platform.organizations.ensure);
  const requested = React.useRef(false);

  React.useEffect(() => {
    if (!organizations || organizations.organizations.length > 0 || requested.current) return;
    requested.current = true;
    void ensure({}).catch(() => { requested.current = false; });
  }, [organizations, ensure]);

  return null;
}
