"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@web-app-starter/auth/client";
import { Button, Input, Label } from "@web-app-starter/design-system";
import { PasswordInput } from "@/components/ui/localized-controls";
import { OrganizationFeedback } from "./organization-feedback";

export function OrganizationStepUp() {
  const t = useTranslations("organizations");
  const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const verify = async (kind: "password" | "totp" | "passkey") => {
    setBusy(true); setError(null);
    try {
      const result = kind === "password" ? await authClient.$fetch("/verify-password", { method: "POST", body: { password } })
        : kind === "totp" ? await authClient.twoFactor.verifyTotp({ code }) : await authClient.signIn.passkey();
      if (result.error) throw new Error("REAUTHENTICATION_REQUIRED");
      setPassword(""); setCode("");
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  return <details className="rounded-lg border p-4" data-agent-sensitive><summary className="cursor-pointer font-medium">{t("verifyIdentity")}</summary><div className="mt-4 space-y-4">
    <p className="text-sm text-muted-foreground">{t("reauthenticate")}</p>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); void verify("password"); }}><Label htmlFor="organization-step-up-password">{t("currentPassword")}</Label><PasswordInput id="organization-step-up-password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /><Button variant="outline" disabled={busy}>{t("verifyCredential")}</Button></form>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); void verify("totp"); }}><Label htmlFor="organization-step-up-code">{t("authenticatorCode")}</Label><Input id="organization-step-up-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} required /><Button variant="outline" disabled={busy}>{t("verify")}</Button></form>
    <Button variant="outline" disabled={busy} onClick={() => void verify("passkey")}>{t("usePasskey")}</Button>
    {Boolean(error) && <OrganizationFeedback error={error} />}
  </div></details>;
}
