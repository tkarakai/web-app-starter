"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@repo/backend";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@web-app-starter/design-system";
import { ChangePasswordForm, PasskeySection, TwoFactorSection } from "@web-app-starter/auth-ui";
import { PasswordInput } from "@/components/ui/localized-controls";
import { useSafeQuery } from "@/hooks/use-safe-query";
import { usePersonalDataContext } from "@/hooks/use-personal-data";
import { usePersonalDispatch } from "@/hooks/use-personal-dispatch";
import { OrganizationFeedback } from "./organization-feedback";

export function EnrollmentPanel({ organizationId, started, personal }: { organizationId: string; started: boolean; personal: boolean }) {
  const t = useTranslations("organizations");
  const [begun, setBegun] = useState(started);
  const [name, setName] = useState(""); const [slug, setSlug] = useState("");
  const [password, setPassword] = useState(""); const [recoveryPassword, setRecoveryPassword] = useState("");
  const [firstCode, setFirstCode] = useState(""); const [secondCode, setSecondCode] = useState("");
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const context = usePersonalDataContext();
  const capture = usePersonalDispatch(context, context.tenant ?? undefined, organizationId);
  const begin = useMutation(api.platform.organizationEnrollment.begin);
  const verify = useAction(api.platform.organizationEnrollment.verifyCredential);
  const acknowledge = useAction(api.platform.organizationEnrollment.acknowledgeRecovery);
  const complete = useMutation(api.platform.organizationEnrollment.complete);
  const status = useSafeQuery(api.platform.organizationEnrollment.status, begun || started ? { organizationId } : "skip");
  const run = async (call: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await capture().dispatch(call); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  if (!begun && !started) return <Card><CardHeader><CardTitle>{t("start")}</CardTitle></CardHeader><CardContent>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void run(async () => { await begin({ organizationId, name: name.trim(), slug: slug.trim() }); setBegun(true); }); }}>
      <p className="text-sm text-muted-foreground">{t("preserve")}</p>
      <div className="space-y-2"><Label htmlFor="organization-name">{t("name")}</Label><Input id="organization-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></div>
      <div className="space-y-2"><Label htmlFor="organization-slug">{t("slug")}</Label><Input id="organization-slug" value={slug} onChange={event => setSlug(event.target.value.toLowerCase())} pattern="[a-z0-9][a-z0-9-]{1,62}" maxLength={63} dir="ltr" required /><p className="text-xs text-muted-foreground">{t("slugHelp")}</p></div>
      {Boolean(error) && <OrganizationFeedback error={error} />}
      <Button type="submit" disabled={busy}>{t("begin")}</Button>
    </form>
  </CardContent></Card>;
  const proof = status.data;
  return <div className="space-y-6" data-agent-sensitive>
    <div><h2 className="text-lg font-semibold">{t("enrollment")}</h2><p className="text-sm text-muted-foreground">{personal ? t("preserve") : t("pendingAdmin")}</p></div>
    {(error || status.error) && <OrganizationFeedback error={error ?? status.error} onRetry={() => window.location.reload()} />}
    <Card><CardHeader><CardTitle>{t("credential")}</CardTitle></CardHeader><CardContent className="space-y-4">
      <details><summary className="cursor-pointer text-sm font-medium">{t("upgradePassword")}</summary><div className="pt-4"><ChangePasswordForm /></div></details>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async () => { try { await verify({ organizationId, password }); } finally { setPassword(""); } }); }}>
        <Label htmlFor="organization-password">{t("currentPassword")}</Label><PasswordInput id="organization-password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
        <Button type="submit" variant="outline" disabled={busy || !password}>{t("verifyCredential")}</Button>
        {proof?.setup.passwordVerified && <p role="status" className="text-sm">{t("verified")}</p>}
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{t("authenticator")}</CardTitle></CardHeader><CardContent><TwoFactorSection /></CardContent></Card>
    {proof && proof.passkeyPolicy !== "disabled" && <Card><CardHeader><CardTitle>{t("passkey")}</CardTitle></CardHeader><CardContent><PasskeySection /></CardContent></Card>}
    <Card><CardHeader><CardTitle>{t("recovery")}</CardTitle></CardHeader><CardContent>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async () => { try { await acknowledge({ organizationId, password: recoveryPassword, codes: [firstCode.trim(), secondCode.trim()] }); } finally { setRecoveryPassword(""); setFirstCode(""); setSecondCode(""); } }); }}>
        <p className="text-sm text-muted-foreground">{t("recoveryHelp")}</p>
        <Label htmlFor="organization-recovery-password">{t("currentPassword")}</Label><PasswordInput id="organization-recovery-password" autoComplete="current-password" value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} required />
        <Label htmlFor="organization-code-one">{t("firstCode")}</Label><Input id="organization-code-one" type="password" autoComplete="off" value={firstCode} onChange={event => setFirstCode(event.target.value)} required />
        <Label htmlFor="organization-code-two">{t("secondCode")}</Label><Input id="organization-code-two" type="password" autoComplete="off" value={secondCode} onChange={event => setSecondCode(event.target.value)} required />
        <Button type="submit" variant="outline" disabled={busy || !proof?.hasTotp}>{t("acknowledge")}</Button>
        {proof?.setup.backupAcknowledged && <p role="status" className="text-sm">{t("verified")}</p>}
      </form>
    </CardContent></Card>
    <div className="space-y-4 rounded-lg border p-4">
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={event => setConsent(event.target.checked)} />{t("contactConsent")}</label>
      <p className="text-sm text-muted-foreground">{t("privateNotice")}</p>
      <Button disabled={busy || !consent || !proof?.allowed || !proof.recent || !proof.setup.passwordVerified || !proof.setup.backupAcknowledged} onClick={() => void run(() => complete({ organizationId }))}>{t("complete")}</Button>
    </div>
  </div>;
}
