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
import { OrganizationFactorReplacement } from "../settings/organization-factor-replacement";

type Props = { children: React.ReactNode; requireRecent?: boolean; enrollment?: boolean; admin?: boolean; authorizationOnly?: boolean };
type GateUser = { _id: string; email?: string } | null | undefined;

/** Presentation of the server's decision; every API enforces that decision independently. */
export function SessionAccessGate(props: Props) {
  const session = authClient.useSession();
  const user = useQuery(api.platform.auth.getCurrentUser, {});
  const [lastActor, setLastActor] = React.useState<string | null>(null);
  const clientActor = session.data?.user.id ?? null;
  const backendActor = user?._id ?? null;
  const conflict = Boolean(clientActor && backendActor && clientActor !== backendActor);
  const observedActor = clientActor ?? backendActor;
  const actor = observedActor ?? (session.isPending ? lastActor : null);
  React.useEffect(() => {
    if (conflict) setLastActor(null);
    else if (observedActor || !session.isPending) setLastActor(observedActor);
  }, [conflict, observedActor, session.isPending]);
  // Better Auth can report settled null during rotation while Convex still
  // identifies the actor. Preserve only the mount, never authorization. A
  // conflicting identity or settled loss of both identities discards all state.
  const identityKey = JSON.stringify(conflict ? [clientActor, backendActor] : [actor]);
  return <ActorSessionAccessGate key={identityKey} {...props} user={user} actorId={session.isPending ? null : clientActor} />;
}

function ActorSessionAccessGate({ children, requireRecent = false, enrollment = false, admin = false, authorizationOnly = false, actorId, user }: Props & { actorId: string | null; user: GateUser }) {
  const currentStatus = useQuery(api.platform.sessionAssurance.status, {});
  const [lastStatus, setLastStatus] = React.useState(currentStatus);
  React.useEffect(() => {
    if (currentStatus) setLastStatus(currentStatus);
  }, [currentStatus]);
  const status = currentStatus ?? lastStatus;
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
  const passwordId = React.useId();
  const [code, setCode] = React.useState("");
  const codeId = React.useId();
  const [backup, setBackup] = React.useState(false);
  const usingBackup = !authorizationOnly && backup;
  const [busy, setBusy] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const live = !signingOut && Boolean(actorId && user?._id === actorId) && currentStatus != null && status && status.expiresAt > now;
  const hasPasskey = Boolean(status?.hasPasskey && status.passkeyPolicy !== "disabled");
  const hasFactor = Boolean(status?.hasTotp || hasPasskey);
  const enrolling = !authorizationOnly && enrollment && status?.reason === "enrollment";
  const recent = status && (enrolling && !hasFactor
    ? status.primaryRecentUntil > now : status.recent && status.recentUntil > now);
  const purposeAllowed = authorizationOnly ? status?.authPurpose === "mcp-authorization" : status?.authPurpose !== "mcp-authorization";
  const allowed = purposeAllowed && live && (status.allowed || enrolling) && (!requireRecent || recent);
  const [admitted, setAdmitted] = React.useState(false);
  React.useEffect(() => { if (allowed && (!panel || authorizationOnly)) setAdmitted(true); }, [allowed, panel, authorizationOnly]);
  const sendVerification = async () => {
    if (!user?.email) return;
    setBusy(true); setError(false);
    try {
      const result = await authClient.sendVerificationEmail({ email: user.email, callbackURL: window.location.origin + (admin ? "/dashboard" : `/${locale}/dashboard`) });
      if (mounted.current) { if (result.error) setError(true); else setEmailSent(true); }
    } catch { if (mounted.current) setError(true); } finally { if (mounted.current) setBusy(false); }
  };
  const signOut = async () => {
    // Discard credentials and hidden ceremony content before the request settles.
    setSigningOut(true); setAdmitted(false); setPanel(null);
    setPassword(""); setCode(""); setBackup(false);
    await authClient.signOut();
    if (mounted.current) window.location.assign(admin ? "/sign-in" : `/${locale}/sign-in`);
  };
  const verify = async (kind: "password" | "totp" | "backup" | "passkey") => {
    setBusy(true); setError(false);
    try {
      const result = kind === "password" ? await authClient.$fetch("/verify-password", { method: "POST", body: { password } })
        : kind === "totp" ? await authClient.twoFactor.verifyTotp({ code })
        : kind === "backup" ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.signIn.passkey();
      if (!mounted.current) return;
      if (result.error) { setError(true); return; }
      setPassword(""); setCode(""); setBackup(false);
    } catch { if (mounted.current) setError(true); } finally { if (mounted.current) setBusy(false); }
  };
  const panelAllowed = !authorizationOnly && panel && live && (panel !== "passkey" || status.passkeyPolicy !== "disabled") && (
    (status.allowed || enrolling || status.reason === "passkey_enrollment") && recent
    || status.reason === "recovery" && panel === "recovery"
    || status.reason === "mfa_enrollment" && !hasFactor && status.primaryRecentUntil > now
  );
  const panelContent = !authorizationOnly && panel && status && <Card className="mx-auto my-8 w-full max-w-lg"><CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader><CardContent className="space-y-4">
    {panel === "passkey" ? <><PasskeySection />{hasPasskey && !allowed && <Button disabled={busy} onClick={() => void verify("passkey")}>{t("usePasskey")}</Button>}<Button disabled={!allowed} onClick={() => setPanel(null)}>{t("continue")}</Button></>
      : panel === "recovery" && status.scope === "user" ? <OrganizationFactorReplacement onComplete={() => setPanel(null)} onCancel={() => setPanel(null)} />
      : <TwoFactorSection recover={panel === "recovery"} onComplete={() => setPanel(null)} onCancel={() => setPanel(null)} />}
    <Button variant="ghost" onClick={signOut}>{tc("signOut")}</Button>
  </CardContent></Card>;
  const display = (content: React.ReactNode, granted = false) => <>
    <React.Activity mode={granted ? "visible" : "hidden"}>
      <div>{(admitted || granted) ? children : null}</div>
    </React.Activity>
    <React.Activity mode={panelAllowed ? "visible" : "hidden"}>
      <div>{panelContent}</div>
    </React.Activity>
    {content}
  </>;
  if (status == null || now === 0 || currentStatus == null) return display(<p role="status">{tc("loading")}</p>);
  if (panelAllowed) return display(null);
  if (allowed && (!panel || authorizationOnly)) return display(null, true);
  const needsPassword = status.reason === "reauthenticate" || status.reason === "method_disabled" || !status.strongForChanges || ((status.reason === "mfa_enrollment" || status.reason === "passkey_enrollment") && status.primaryRecentUntil <= now && !hasFactor) || (enrolling && !hasFactor);
  return display(<Card className="mx-auto my-8 w-full max-w-lg"><CardHeader><CardTitle>{t("title")}</CardTitle></CardHeader><CardContent className="space-y-4">
    <p>{t(live ? "description" : "expired")}</p>
    {error && <p role="alert" className="text-destructive">{t("failed")}</p>}
    {live && authorizationOnly && ["email_verification", "enrollment", "recovery", "mfa_enrollment", "passkey_enrollment"].includes(status.reason) ? <p>Complete account verification and security setup in the normal admin app, then restart authorization.</p>
      : live && status.reason === "email_verification" ? <>{emailSent && <p role="status">{te("resent")}</p>}<Button disabled={busy || !user} onClick={() => void sendVerification()}>{t("verifyEmail")}</Button></>
      : live && status.reason === "enrollment" && !enrollment ? <p>{t("enrollment")}</p>
      : live && (status.reason === "recovery" || status.reason === "mfa_enrollment" && status.primaryRecentUntil > now) ? <>
        <p>{status.reason === "recovery" ? t("recovery") : t2("requiredNotice")}</p>
        <Button onClick={() => setPanel(status.reason === "recovery" ? "recovery" : "totp")}>{t2("enable")}</Button>
        {status.reason !== "recovery" && status.passkeyPolicy !== "disabled" && <Button variant="outline" onClick={() => setPanel("passkey")}>{t("addPasskey")}</Button>}
      </>
      : live && status.reason === "passkey_enrollment" && recent ? <Button onClick={() => setPanel("passkey")}>{t("addPasskey")}</Button>
      : live ? <>
        {needsPassword ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void verify("password"); }}>
          <Label htmlFor={passwordId}>{tp("currentPassword")}</Label>
          <PasswordInput id={passwordId} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          <Button disabled={busy || !password}>{t("verify")}</Button>
        </form> : status.hasTotp && status.reason !== "passkey_verification" ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void verify(usingBackup ? "backup" : "totp"); }}>
          <Label htmlFor={codeId}>{usingBackup ? t2("backupCodes") : t2("enterCode")}</Label>
          {usingBackup ? <Input id={codeId} value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
            : <OtpInput aria-label={t2("enterCode")} value={code} onChange={setCode} disabled={busy} />}
          <Button disabled={busy || !code}>{t("verify")}</Button>
          {!authorizationOnly && <Button type="button" variant="ghost" onClick={() => { setBackup(!backup); setCode(""); }}>{usingBackup ? t2("enterCode") : t2("backupCodes")}</Button>}
        </form> : null}
        {hasPasskey && <Button variant="outline" disabled={busy} onClick={() => void verify("passkey")}>{t("usePasskey")}</Button>}
      </> : null}
    <Button variant="ghost" onClick={signOut}>{tc("signOut")}</Button>
  </CardContent></Card>);
}

/** Admin is English-only and does not require an app message catalogue. */
export function AdminSessionAccessGate(props: Omit<Props, "admin">) {
  return <NextIntlClientProvider locale="en" messages={english} timeZone="UTC"><SessionAccessGate {...props} admin /></NextIntlClientProvider>;
}
