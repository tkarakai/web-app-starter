"use client";

import * as React from "react";
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";
import english from "@web-app-starter/i18n/messages/en.json";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@web-app-starter/design-system";
import { PasswordInput, OtpInput } from "./localized-controls";
import { TwoFactorSection } from "../settings/two-factor-section";
import { PasskeySection } from "../settings/passkey-section";

type Props = { children: React.ReactNode; requireRecent?: boolean; enrollment?: boolean; admin?: boolean; preserveChildren?: boolean };

/** Presentation of the server's decision; every API enforces that decision independently. */
export function SessionAccessGate({ children, requireRecent = false, enrollment = false, admin = false, preserveChildren = false }: Props) {
  const currentStatus = useQuery(api.platform.sessionAssurance.status, {});
  const [lastStatus, setLastStatus] = React.useState(currentStatus);
  React.useEffect(() => {
    if (currentStatus) { setLastStatus(currentStatus); return; }
    // Token rotation can briefly clear the query. Keep only the presentation stable;
    // all server operations continue checking the current live session.
    const timer = setTimeout(() => setLastStatus(currentStatus), 3000);
    return () => clearTimeout(timer);
  }, [currentStatus]);
  const status = currentStatus ?? lastStatus;
  const user = useQuery(api.platform.auth.getCurrentUser, {});
  const te = useTranslations("auth.verifyEmail");
  const [emailSent, setEmailSent] = React.useState(false);
  const t = useTranslations("accountSecurity.session");
  const tc = useTranslations("common");
  const t2 = useTranslations("accountSecurity.twoFactor");
  const tp = useTranslations("accountSecurity.changePassword");
  const locale = useLocale();
  const [now, setNow] = React.useState(0);
  const [panel, setPanel] = React.useState<"totp" | "recovery" | "passkey" | null>(null);
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [backup, setBackup] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const live = status && status.expiresAt > now;
  const enrolling = enrollment && status?.reason === "enrollment";
  const recent = status && (enrolling && !status.hasTotp && !status.hasPasskey
    ? status.primaryRecentUntil > now : status.recent && status.recentUntil > now);
  const allowed = live && (status.allowed || enrolling) && (!requireRecent || recent);
  const sendVerification = async () => {
    if (!user?.email) return;
    setBusy(true); setError(false);
    try {
      const result = await authClient.sendVerificationEmail({ email: user.email, callbackURL: window.location.origin + (admin ? "/dashboard" : `/${locale}/dashboard`) });
      if (result.error) setError(true); else setEmailSent(true);
    } catch { setError(true); } finally { setBusy(false); }
  };
  const signOut = async () => {
    await authClient.signOut();
    window.location.assign(admin ? "/sign-in" : `/${locale}/sign-in`);
  };
  const verify = async (kind: "password" | "totp" | "backup" | "passkey") => {
    setBusy(true); setError(false);
    try {
      const result = kind === "password" ? await authClient.$fetch("/verify-password", { method: "POST", body: { password } })
        : kind === "totp" ? await authClient.twoFactor.verifyTotp({ code })
        : kind === "backup" ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.signIn.passkey();
      if (result.error) { setError(true); return; }
      setPassword(""); setCode(""); setBackup(false);
    } catch { setError(true); } finally { setBusy(false); }
  };
  const display = (content: React.ReactNode, granted = false) => preserveChildren
    ? <><div hidden={!granted}>{children}</div>{granted ? null : content}</> : content;
  if (status === undefined || now === 0) return display(<p role="status">{tc("loading")}</p>);
  // Keep enrollment mounted through token rotation and until backup codes are saved.
  if (panel && live) return display(<Card className="mx-auto my-8 w-full max-w-lg"><CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader><CardContent className="space-y-4">
    {panel === "passkey" ? <><PasskeySection />{status.hasPasskey && !allowed && <Button disabled={busy} onClick={() => void verify("passkey")}>{t("usePasskey")}</Button>}<Button disabled={!allowed} onClick={() => setPanel(null)}>{t("continue")}</Button></>
      : <TwoFactorSection recover={panel === "recovery"} onComplete={() => setPanel(null)} onCancel={() => setPanel(null)} />}
    <Button variant="ghost" onClick={signOut}>{tc("signOut")}</Button>
  </CardContent></Card>);
  if (panel && status === null) return display(<p role="status">{tc("loading")}</p>);
  if (allowed) return display(children, true);
  const needsPassword = status?.reason === "reauthenticate" || status?.reason === "method_disabled" || !status?.strongForChanges || ((status?.reason === "mfa_enrollment" || status?.reason === "passkey_enrollment") && status.primaryRecentUntil <= now && !status.hasTotp && !status.hasPasskey) || (enrolling && !status.hasTotp && !status.hasPasskey);
  return display(<Card className="mx-auto my-8 w-full max-w-lg"><CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader><CardContent className="space-y-4">
    <p>{t(live ? "description" : "expired")}</p>
    {error && <p role="alert" className="text-destructive">{t("failed")}</p>}
    {live && status.reason === "email_verification" ? <>{emailSent && <p role="status">{te("resent")}</p>}<Button disabled={busy || !user} onClick={() => void sendVerification()}>{t("verifyEmail")}</Button></>
      : live && status.reason === "enrollment" && !enrollment ? <p>{t("enrollment")}</p>
      : live && (status.reason === "recovery" || status.reason === "mfa_enrollment" && status.primaryRecentUntil > now) ? <>
        <p>{status.reason === "recovery" ? t("recovery") : t2("requiredNotice")}</p>
        <Button onClick={() => setPanel(status.reason === "recovery" ? "recovery" : "totp")}>{t2("enable")}</Button>
        {status.reason !== "recovery" && status.passkeyPolicy !== "disabled" && <Button variant="outline" onClick={() => setPanel("passkey")}>{t("addPasskey")}</Button>}
      </>
      : live && status.reason === "passkey_enrollment" && recent ? <Button onClick={() => setPanel("passkey")}>{t("addPasskey")}</Button>
      : live ? <>
        {needsPassword ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void verify("password"); }}>
          <Label htmlFor="session-password">{tp("currentPassword")}</Label>
          <PasswordInput id="session-password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          <Button disabled={busy || !password}>{t("verify")}</Button>
        </form> : status.hasTotp && status.reason !== "passkey_verification" ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void verify(backup ? "backup" : "totp"); }}>
          <Label htmlFor="session-code">{backup ? t2("backupCodes") : t2("enterCode")}</Label>
          {backup ? <Input id="session-code" value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
            : <OtpInput aria-label={t2("enterCode")} value={code} onChange={setCode} disabled={busy} />}
          <Button disabled={busy || !code}>{t("verify")}</Button>
          <Button type="button" variant="ghost" onClick={() => { setBackup(!backup); setCode(""); }}>{backup ? t2("enterCode") : t2("backupCodes")}</Button>
        </form> : null}
        {status.hasPasskey && status.passkeyPolicy !== "disabled" && <Button variant="outline" disabled={busy} onClick={() => void verify("passkey")}>{t("usePasskey")}</Button>}
      </> : null}
    <Button variant="ghost" onClick={signOut}>{tc("signOut")}</Button>
  </CardContent></Card>);
}

/** Admin is English-only and does not require an app message catalogue. */
export function AdminSessionAccessGate(props: Omit<Props, "admin">) {
  return <NextIntlClientProvider locale="en" messages={english} timeZone="UTC"><SessionAccessGate {...props} admin /></NextIntlClientProvider>;
}
