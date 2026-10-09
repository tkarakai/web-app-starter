"use client";

import { useTranslations } from "next-intl";
import { Button } from "@web-app-starter/design-system";

export function organizationErrorKey(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/EMAIL_VERIFICATION_REQUIRED|EMAIL_NOT_VERIFIED/.test(message)) return "verifyEmail";
  if (/READINESS|CUTOVER|MIGRATION|MAINTENANCE|REGISTRY/.test(message)) return "notReady";
  if (/LAST_ORGANIZATION_ADMIN|LAST_EFFECTIVE|CONTACT/.test(message)) return "lastAdmin";
  if (/RECENT_AUTHENTICATION|REAUTHENTICATION|NOT_AUTHENTICATED|SECURITY_ENROLLMENT|MFA_REQUIRED/.test(message)) return "reauthenticate";
  if (/INVITATION|TOKEN|CAPABILITY/.test(message)) return "invalidInvitation";
  if (/PASSWORD|CREDENTIAL/.test(message)) return "credentialError";
  if (/RECOVERY|TOTP/.test(message)) return "proofError";
  if (/SLUG/.test(message)) return "slugError";
  if (/ACCOUNT_ALREADY_EXISTS/.test(message)) return "accountExists";
  if (/RATE_LIMIT/.test(message)) return "rateLimited";
  if (/NOT_CUSTOMER|NOT_ORGANIZATION_ADMIN|ORGANIZATION_UNAVAILABLE|PERSONAL_CONTEXT/.test(message)) return "unavailable";
  return "error";
}
export function OrganizationFeedback({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations("organizations");
  return <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
    <p>{t(organizationErrorKey(error))}</p>
    {onRetry && <Button variant="outline" onClick={onRetry}>{t("retry")}</Button>}
  </div>;
}
