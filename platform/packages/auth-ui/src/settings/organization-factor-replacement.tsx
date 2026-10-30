"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAction } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@repo/backend";
import { authClient } from "@web-app-starter/auth/client";
import { Button, Input, Label } from "@web-app-starter/design-system";
import { CopyableField, PasswordInput, StyledQrCode } from "../components/localized-controls";

/** Stage replacement beside the current factor; only verified completion changes live authority. */
export function OrganizationFactorReplacement({ onComplete, onCancel }: { onComplete?: () => void; onCancel?: () => void } = {}) {
  const t = useTranslations("accountSecurity.session"); const t2 = useTranslations("accountSecurity.twoFactor");
  const tp = useTranslations("accountSecurity.changePassword"); const tc = useTranslations("common");
  const begin = useAction(api.platform.organizationFactorReplacement.begin); const complete = useAction(api.platform.organizationFactorReplacement.complete);
  const [staged, setStaged] = useState<{ changeId: string; totpURI: string; backupCodes: string[] } | null>(null);
  const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [first, setFirst] = useState(""); const [second, setSecond] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [done, setDone] = useState(false);
  const id = useId(); const session = authClient.useSession(); const identity = session.data?.user.id;
  const liveIdentity = useRef(identity); liveIdentity.current = identity;
  const [ceremonyIdentity, setCeremonyIdentity] = useState(identity);
  const generation = useRef({ version: 0 });
  useEffect(() => {
    const lease = generation.current;
    lease.version++; setBusy(false);
    // Activity hides a restricted session without unmounting the ceremony. Its
    // effect reconnect must preserve issued codes for the same browser identity.
    if (ceremonyIdentity !== identity) {
      setCeremonyIdentity(identity); setStaged(null); setPassword(""); setCode(""); setFirst(""); setSecond(""); setDone(false); setError(false);
    }
    return () => { lease.version++; };
  }, [identity, ceremonyIdentity]);
  const run = async (call: (assertCurrent: () => void) => Promise<void>) => {
    const capturedIdentity = identity; const capturedGeneration = generation.current.version;
    const assertCurrent = () => { if (!capturedIdentity || liveIdentity.current !== capturedIdentity || generation.current.version !== capturedGeneration) throw new Error("SECURITY_CONTEXT_CHANGED"); };
    setBusy(true); setError(false);
    try { assertCurrent(); await call(assertCurrent); } catch { if (generation.current.version === capturedGeneration) setError(true); } finally { if (generation.current.version === capturedGeneration) setBusy(false); }
  };
  const secret = (() => { try { return staged ? new URL(staged.totpURI).searchParams.get("secret") : null; } catch { return null; } })();
  if (ceremonyIdentity !== identity) return <p role="status">{tc("loading")}</p>;
  return <div className="space-y-4" data-agent-sensitive>
    <p className="text-sm text-muted-foreground">{t("recovery")}</p>
    {error && <p role="alert" className="text-sm text-destructive">{t("failed")}</p>}
    {done ? <p role="status">{t2("enabled")}</p> : !staged ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async assertCurrent => { const result = await begin({ password }); assertCurrent(); setStaged(result); setPassword(""); }); }}>
      <Label htmlFor={`${id}-password`}>{tp("currentPassword")}</Label><PasswordInput id={`${id}-password`} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /><Button disabled={busy}>{t("continue")}</Button>
    </form> : <div className="space-y-4">
      <p className="text-sm">{t2("scanQrCode")}</p><StyledQrCode value={staged.totpURI} />
      <details><summary className="cursor-pointer text-sm">{t2("manualEntry")}</summary><code className="break-all">{secret}</code></details>
      <p className="text-sm">{t2("backupCodesDescription")}</p><CopyableField value={staged.backupCodes.join("\n")} rows={10} />
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async assertCurrent => { await complete({ changeId: staged.changeId, code, backupCodes: [first.trim(), second.trim()] }); assertCurrent(); setStaged(null); setCode(""); setFirst(""); setSecond(""); setDone(true); onComplete?.(); }); }}>
        <Label htmlFor={`${id}-code`}>{t2("enterCode")}</Label><Input id={`${id}-code`} value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} />
        <Label htmlFor={`${id}-first`}>{t2("backupCodes")} (1)</Label><Input id={`${id}-first`} type="password" autoComplete="off" value={first} onChange={event => setFirst(event.target.value)} required disabled={busy} />
        <Label htmlFor={`${id}-second`}>{t2("backupCodes")} (2)</Label><Input id={`${id}-second`} type="password" autoComplete="off" value={second} onChange={event => setSecond(event.target.value)} required disabled={busy} />
        <Button disabled={busy || !first.trim() || first.trim() === second.trim()}>{t("verify")}</Button>
      </form>
    </div>}
    {(onCancel || staged) && <Button variant="outline" disabled={busy} onClick={() => { setStaged(null); setPassword(""); setCode(""); setFirst(""); setSecond(""); onCancel?.(); }}>{tc("cancel")}</Button>}
  </div>;
}
