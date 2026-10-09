"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useConvexAuth } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@repo/backend";
import type { FunctionReturnType } from "convex/server";
import { authClient } from "@web-app-starter/auth/client";
import { useRouter } from "@web-app-starter/i18n/navigation";
import { EMAIL_VERIFICATION_CALLBACK_URL } from "@web-app-starter/auth-ui";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@web-app-starter/design-system";
import { PasswordInput } from "@/components/ui/localized-controls";
import { selectOrganization } from "@/hooks/organization-selection";
import { useSafeQuery } from "@/hooks/use-safe-query";
import { OrganizationFeedback } from "./organization-feedback";
import { clearOrganizationInvitation, parseOrganizationInvitation, readOrganizationInvitation, saveOrganizationInvitation, type SavedOrganizationInvitation } from "./invitation-state";

export function InvitationClient() {
  const session = authClient.useSession();
  const [lastActor, setLastActor] = useState<string | null>(null);
  const actor = session.data?.user.id ?? (session.isPending ? lastActor : null);
  useEffect(() => { if (!session.isPending || session.data) setLastActor(session.data?.user.id ?? null); }, [session.data, session.isPending]);
  return <ActorInvitationClient key={actor ?? "signed-out"} />;
}

function ActorInvitationClient() {
  const t = useTranslations("organizations"); const router = useRouter();
  const session = authClient.useSession(); const { isAuthenticated, isLoading } = useConvexAuth();
  const user = session.data?.user;
  const settled = isAuthenticated && !isLoading && !session.isPending && Boolean(user);
  const backendUser = useSafeQuery(api.platform.auth.getCurrentUser, settled ? {} : "skip");
  // A valid Convex token can still belong to the account just switched away from.
  // Wait for the session-validated backend actor before dispatching admission.
  const sameAccount = settled && backendUser.data?._id === user?.id;
  const preview = useAction(api.platform.memberInvitations.preview); const claim = useAction(api.platform.memberInvitations.claim);
  const register = useAction(api.platform.memberInvitations.register); const requestVerification = useAction(api.platform.memberInvitations.requestVerification);
  const requestRegistrationVerification = useAction(api.platform.memberInvitations.requestRegistrationVerification);
  const accept = useMutation(api.platform.memberInvitations.accept);
  const [invitation, setInvitation] = useState<SavedOrganizationInvitation | null>(null);
  const [details, setDetails] = useState<FunctionReturnType<typeof api.platform.memberInvitations.preview> | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signin" | "register" | "verify" | "totp">("signin");
  const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [sent, setSent] = useState(false); const mounted = useRef(true);
  const requestGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const previewRequest = useRef<{ key: string; promise: ReturnType<typeof preview> } | null>(null);
  useEffect(() => {
    let active = true; let revision = 0;
    const load = () => {
      const version = ++revision;
      const hasFragment = Boolean(window.location.hash);
      const saved = hasFragment ? parseOrganizationInvitation(window.location.hash) : readOrganizationInvitation();
      // Consume before rendering or making requests; never transfer a bearer into a query.
      if (hasFragment) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setLoading(true); setError(null); setDetails(null);
      if (!saved) { requestGeneration.current++; clearOrganizationInvitation(); setInvitation(null); setError(new Error("INVALID_MEMBER_INVITATION")); setLoading(false); setBusy(false); return; }
      const key = `${saved.organizationId}:${saved.token}`;
      if (previewRequest.current?.key !== key) {
        requestGeneration.current++; setBusy(false);
        setMode("signin"); setPassword(""); setCode(""); setSent(false);
        previewRequest.current = { key, promise: preview({ organizationId: saved.organizationId, token: saved.token }) };
      }
      // StrictMode and Activity reconnect effects. Reuse this one preview, rather
      // than consuming another token-claim attempt for the same mounted page.
      saveOrganizationInvitation(saved); setInvitation(saved);
      void previewRequest.current.promise.then(result => { if (active && version === revision) setDetails(result); })
        .catch(failure => { if (active && version === revision) setError(failure); })
        .finally(() => { if (active && version === revision) setLoading(false); });
    };
    load(); window.addEventListener("hashchange", load);
    return () => { active = false; window.removeEventListener("hashchange", load); };
  }, [preview]);
  const run = async (call: (assertCurrent: () => void) => Promise<unknown>) => {
    const generation = requestGeneration.current;
    const current = () => mounted.current && requestGeneration.current === generation;
    const assertCurrent = () => { if (!current()) throw new Error("PERSONAL_CONTEXT_CHANGED"); };
    setBusy(true); setError(null);
    try { await call(assertCurrent); } catch (failure) { if (current()) setError(failure); } finally { if (current()) setBusy(false); }
  };
  const wrongAccount = user && details && user.email.toLowerCase() !== details.email.toLowerCase();
  const acceptInvitation = async (assertCurrent: () => void) => {
    if (!invitation || !user || !sameAccount || !user.emailVerified) return;
    const actor = user.id;
    const result = await accept({ organizationId: invitation.organizationId, token: invitation.token });
    const live = await authClient.getSession();
    assertCurrent();
    if (!mounted.current || live.data?.user.id !== actor) throw new Error("PERSONAL_CONTEXT_CHANGED");
    clearOrganizationInvitation(); selectOrganization(actor, result.organizationId);
    router.push(`${result.adminPending ? "/dashboard/organization" : "/dashboard"}?organizationId=${encodeURIComponent(result.organizationId)}`);
  };
  return <main className="flex min-h-svh items-start justify-center px-4 py-12"><Card className="w-full max-w-lg" data-agent-sensitive><CardHeader><CardTitle>{t("invitationTitle")}</CardTitle></CardHeader><CardContent className="space-y-5">
    {loading ? <p role="status">{t("loading")}</p> : <>
      {details && <div className="space-y-2"><h1 className="text-xl font-semibold break-words">{details.name}</h1><p className="break-all text-sm">{details.email}</p><p className="text-sm text-muted-foreground">{t(details.role === "org-admin" ? "adminInvitation" : "memberInvitation")}</p><p className="text-sm">{t("privateNotice")}</p></div>}
      {error && <OrganizationFeedback error={error} onRetry={() => window.location.reload()} />}
      {sent && <p role="status">{t("verificationSent")}</p>}
      {wrongAccount ? <div className="space-y-3"><p role="alert">{t("wrongAccount")}</p><Button disabled={busy} onClick={() => void run(async assertCurrent => { await authClient.signOut(); assertCurrent(); setMode("signin"); })}>{t("switchAccount")}</Button></div>
        : user ? <div className="space-y-3">
          {!user.emailVerified && <><p>{t("verifyEmail")}</p><Button disabled={busy || !isAuthenticated || !invitation} onClick={() => void run(async assertCurrent => { if (invitation) { await requestVerification({ organizationId: invitation.organizationId, token: invitation.token }); assertCurrent(); setSent(true); } })}>{t("sendVerification")}</Button></>}
          <Button disabled={busy || !sameAccount || !user.emailVerified || !invitation} onClick={() => void run(acceptInvitation)}>{t("acceptInvitation")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(async assertCurrent => { await authClient.getSession({ query: { disableCookieCache: true } }); assertCurrent(); window.location.reload(); })}>{t("refreshVerification")}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await authClient.signOut(); })}>{t("switchAccount")}</Button>
        </div>
        : details && invitation && <>
          {mode === "verify" ? <div className="space-y-3"><p>{t("verifyEmail")}</p><Button disabled={busy} onClick={() => void run(async assertCurrent => { if (invitation.capability) await requestRegistrationVerification({ capability: invitation.capability, email: details.email }); else { const result = await authClient.sendVerificationEmail({ email: details.email, callbackURL: EMAIL_VERIFICATION_CALLBACK_URL }); if (result.error) throw new Error("EMAIL_VERIFICATION_REQUIRED"); } assertCurrent(); setSent(true); })}>{t("sendVerification")}</Button><Button variant="outline" onClick={() => setMode("signin")}>{t("signIn")}</Button></div>
            : mode === "totp" ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async assertCurrent => { const result = await authClient.twoFactor.verifyTotp({ code }); assertCurrent(); if (result.error) throw new Error("INVALID_TOTP"); setCode(""); setMode("signin"); }); }}><Label htmlFor="invitation-totp">{t("authenticatorCode")}</Label><Input id="invitation-totp" value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /><Button type="submit" disabled={busy}>{t("verify")}</Button></form>
            : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(async assertCurrent => {
              try {
                if (mode === "register") {
                  const capability = invitation.capability ?? (await claim({ organizationId: invitation.organizationId, token: invitation.token })).capability;
                  assertCurrent();
                  const saved = { ...invitation, capability, email: details.email }; saveOrganizationInvitation(saved); setInvitation(saved);
                  await register({ capability, email: details.email, name: name.trim(), password }); assertCurrent(); setMode("verify"); setSent(true);
                } else {
                  const result = await authClient.signIn.email({ email: details.email, password, rememberMe: true });
                  assertCurrent();
                  if (result.error) { if (result.error.code === "EMAIL_NOT_VERIFIED") setMode("verify"); throw new Error(result.error.code === "EMAIL_NOT_VERIFIED" ? "EMAIL_VERIFICATION_REQUIRED" : "REAUTHENTICATION_REQUIRED"); }
                  if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) setMode("totp");
                }
              } finally { try { assertCurrent(); setPassword(""); } catch { /* A newer invitation owns its form. */ } }
            }); }}>
              {mode === "register" && <><Label htmlFor="invitation-name">{t("yourName")}</Label><Input id="invitation-name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} required maxLength={200} /></>}
              <Label htmlFor="invitation-password">{mode === "register" ? t("newPassword") : t("currentPassword")}</Label><PasswordInput id="invitation-password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} />
              <Button type="submit" disabled={busy}>{t(mode === "register" ? "createAccount" : "signIn")}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { setPassword(""); setMode(mode === "register" ? "signin" : "register"); }}>{t(mode === "register" ? "existingAccount" : "newAccount")}</Button>
              {mode === "signin" && <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { const result = await authClient.signIn.passkey(); if (result.error) throw new Error("REAUTHENTICATION_REQUIRED"); })}>{t("usePasskey")}</Button>}
              {invitation.capability && <Button type="button" variant="ghost" onClick={() => setMode("verify")}>{t("sendVerification")}</Button>}
            </form>}
        </>}
    </>}
  </CardContent></Card></main>;
}
