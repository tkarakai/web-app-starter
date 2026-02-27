"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { api } from "@repo/backend";
import { authClient, formatAuthError, isConvexRateLimited, AUTH_RATE_LIMIT_MESSAGE } from "@repo/auth/client";
import { broadcastAuth } from "@/lib/auth-broadcast";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PasswordInput,
  Separator,
  SlideTransition,
} from "@repo/design-system";

type PasskeyPolicy = "disabled" | "optional" | "required";
type SignInStep = 0 | 1 | 2; // 0=email, 1=auth method, 2=TOTP

function toPasskeyPolicy(value: unknown): PasskeyPolicy {
  return value === "disabled" || value === "required" ? value : "optional";
}

function toBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

export function AdminSignInForm() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<SignInStep>(0);

  // Form fields
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // 2FA challenge state
  const [totpCode, setTotpCode] = React.useState("");
  const [useBackupCode, setUseBackupCode] = React.useState(false);
  const [backupCode, setBackupCode] = React.useState("");

  // Preferred method from server
  const preferredMethodResult = useQuery(
    api.signInMethods.getPreferredMethod,
    email.trim() ? { email: email.trim() } : "skip",
  );

  // Policy settings
  const userMfaRequired = useQuery(api.appSettings.getPublic, {
    key: "userMfaRequired",
  });
  const adminMfaRequired = useQuery(api.appSettings.getPublic, {
    key: "adminMfaRequired",
  });
  const userPasskeyPolicy = useQuery(api.appSettings.getPublic, {
    key: "userPasskeyPolicy",
  });
  const adminPasskeyPolicy = useQuery(api.appSettings.getPublic, {
    key: "adminPasskeyPolicy",
  });

  const updatePreferredMethod = useMutation(api.signInMethods.updatePreferredMethod);

  const getRolePolicies = React.useCallback((role: unknown) => {
    const isAdmin = role === "admin";
    return {
      mfaRequired: toBoolean(isAdmin ? adminMfaRequired : userMfaRequired, false),
      passkeyPolicy: toPasskeyPolicy(
        isAdmin ? adminPasskeyPolicy : userPasskeyPolicy,
      ),
    };
  }, [adminMfaRequired, adminPasskeyPolicy, userMfaRequired, userPasskeyPolicy]);

  const enforcePostSignInPolicies = React.useCallback(async ({
    usedPasskey,
  }: {
    usedPasskey: boolean;
  }): Promise<boolean> => {
    const sessionResult = await authClient.getSession();
    const sessionUser = sessionResult.data?.user as Record<string, unknown> | undefined;
    if (!sessionUser) return false;

    const policies = getRolePolicies(sessionUser.role);
    if (usedPasskey && policies.passkeyPolicy === "disabled") {
      await authClient.signOut();
      setError("Passkey sign-in is disabled for your account.");
      return true;
    }

    if (policies.mfaRequired && sessionUser.twoFactorEnabled !== true) {
      router.push("/settings?tab=security&enforce=mfa");
      return true;
    }

    if (policies.passkeyPolicy === "required") {
      const passkeyResult = await (authClient as unknown as {
        passkey?: {
          listUserPasskeys?: () => Promise<{ data?: unknown[]; error?: unknown }>;
        };
      }).passkey?.listUserPasskeys?.();

      if (!passkeyResult || passkeyResult.error) {
        await authClient.signOut();
        setError("Unable to verify passkey policy. Please sign in with passkey.");
        return true;
      }

      const passkeys = passkeyResult.data ?? [];
      if (passkeys.length > 0 && !usedPasskey) {
        await authClient.signOut();
        setError("Passkey sign-in is required for your account.");
        return true;
      }

      if (passkeys.length === 0) {
        router.push("/settings?tab=security&enforce=passkey");
        return true;
      }
    }

    return false;
  }, [getRolePolicies, router]);

  // Step 0 → Step 1: Continue from email
  const handleEmailContinue = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setStep(1);
  };

  // Step 1: Password sign-in
  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/dashboard",
        rememberMe: true,
      });

      if (result.error) {
        setError(formatAuthError(result.error, "Invalid email or password"));
      } else if (
        (result.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect
      ) {
        setStep(2);
      } else {
        if (await enforcePostSignInPolicies({ usedPasskey: false })) return;
        try { await updatePreferredMethod({ method: "password" }); } catch { /* best-effort */ }
        broadcastAuth();
        router.push("/dashboard");
      }
    } catch (err) {
      setError(isConvexRateLimited(err) ? AUTH_RATE_LIMIT_MESSAGE : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  // Step 1: Passkey sign-in
  const handlePasskeySignIn = async () => {
    if (!email.trim()) return;
    setError(null);
    setPending(true);
    try {
      const result = await (authClient as unknown as {
        signIn: {
          passkey: (args: {
            email: string;
            callbackURL: string;
          }) => Promise<{ error?: { message?: string } }>;
        };
      }).signIn.passkey({
        email: email.trim(),
        callbackURL: "/dashboard",
      });

      if (result.error) {
        setError(result.error.message ?? "Passkey sign-in failed");
        return;
      }

      if (await enforcePostSignInPolicies({ usedPasskey: true })) return;
      try { await updatePreferredMethod({ method: "passkey" }); } catch { /* best-effort */ }
      broadcastAuth();
      router.push("/dashboard");
    } catch (err) {
      setError(isConvexRateLimited(err) ? AUTH_RATE_LIMIT_MESSAGE : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  // Step 2: TOTP verification
  const handleTotpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (useBackupCode && !backupCode.trim()) return;
    if (!useBackupCode && totpCode.length !== 6) return;

    setError(null);
    setPending(true);

    try {
      if (useBackupCode) {
        const result = await authClient.twoFactor.verifyBackupCode({
          code: backupCode.trim(),
        });
        if (result.error) {
          setError(formatAuthError(result.error, "Invalid backup code"));
        } else {
          if (await enforcePostSignInPolicies({ usedPasskey: false })) return;
          try { await updatePreferredMethod({ method: "password" }); } catch { /* best-effort */ }
          broadcastAuth();
          router.push("/dashboard");
        }
      } else {
        const result = await authClient.twoFactor.verifyTotp({ code: totpCode });
        if (result.error) {
          setError(formatAuthError(result.error, "Invalid verification code"));
        } else {
          if (await enforcePostSignInPolicies({ usedPasskey: false })) return;
          try { await updatePreferredMethod({ method: "password" }); } catch { /* best-effort */ }
          broadcastAuth();
          router.push("/dashboard");
        }
      }
    } catch (err) {
      setError(isConvexRateLimited(err) ? AUTH_RATE_LIMIT_MESSAGE : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const goBack = () => {
    setError(null);
    if (step === 2) {
      setTotpCode("");
      setBackupCode("");
      setUseBackupCode(false);
      setStep(1);
    } else if (step === 1) {
      setPassword("");
      setStep(0);
    }
  };

  const preferred = preferredMethodResult?.preferred;

  const stepTitle = [
    "Sign in",
    "Sign in",
    useBackupCode ? "Backup code" : "Two-factor authentication",
  ][step];

  const stepDescription = [
    "Admin access only. Enter your email to continue.",
    `Signing in as ${email}`,
    useBackupCode
      ? "Enter one of your backup codes to sign in."
      : "Enter the 6-digit code from your authenticator app.",
  ][step];

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{stepTitle}</CardTitle>
        <CardDescription>{stepDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <SlideTransition stepIndex={step}>
          {step === 0 ? (
            /* ── Step 0: Email ── */
            <form className="space-y-4" onSubmit={handleEmailContinue}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              </div>
              {error ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
              <Button className="w-full" type="submit" disabled={!email.trim()}>
                Continue
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Separator className="flex-1 min-w-0 w-auto" />
                <span>Secure email + password</span>
                <Separator className="flex-1 min-w-0 w-auto" />
              </div>
            </form>
          ) : step === 1 ? (
            /* ── Step 1: Auth Method ── */
            preferred === "passkey" ? (
              /* Passkey-primary layout */
              <div className="space-y-4">
                <Button
                  className="w-full"
                  type="button"
                  onClick={handlePasskeySignIn}
                  disabled={pending}
                >
                  {pending ? "Authenticating..." : "Sign in with passkey"}
                </Button>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>
                <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      <Link
                        href="/forgot-password"
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <PasswordInput
                      id="password"
                      name="password"
                      placeholder="Your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>
                  {error ? (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  ) : null}
                  <Button className="w-full" type="submit" variant="outline" disabled={pending}>
                    {pending ? "Signing in..." : "Sign in with password"}
                  </Button>
                </form>
                <button
                  type="button"
                  className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={goBack}
                  disabled={pending}
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </button>
              </div>
            ) : (
              /* Password-primary layout (default) */
              <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <PasswordInput
                    id="password"
                    name="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {error ? (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
                <Button className="w-full" type="submit" disabled={pending}>
                  {pending ? "Signing in..." : "Sign in"}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Separator className="flex-1 min-w-0 w-auto" />
                  <span>OR</span>
                  <Separator className="flex-1 min-w-0 w-auto" />
                </div>
                <Button type="button" variant="ghost" className="w-full" onClick={handlePasskeySignIn} disabled={pending}>
                  Sign in with passkey
                </Button>
                <button
                  type="button"
                  className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={goBack}
                  disabled={pending}
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </button>
              </form>
            )
          ) : (
            /* ── Step 2: TOTP ── */
            <form className="space-y-4" onSubmit={handleTotpSubmit}>
              {useBackupCode ? (
                <div className="space-y-2">
                  <Label htmlFor="backup-code">Backup code</Label>
                  <Input
                    id="backup-code"
                    name="backup-code"
                    type="text"
                    placeholder="Enter backup code"
                    value={backupCode}
                    onChange={(event) => setBackupCode(event.target.value)}
                    autoFocus
                    autoComplete="off"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="totp-code">Verification code</Label>
                  <Input
                    id="totp-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(event) =>
                      setTotpCode(event.target.value.replace(/\D/g, ""))
                    }
                    required
                    autoFocus
                    autoComplete="one-time-code"
                    className="text-center text-lg tracking-widest font-mono"
                  />
                </div>
              )}
              {process.env.NODE_ENV === "development" ? (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Dev: Check server console for TOTP code.
                </div>
              ) : null}
              {error ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
              <Button
                className="w-full"
                type="submit"
                disabled={pending || (useBackupCode ? !backupCode.trim() : totpCode.length !== 6)}
              >
                {pending ? "Verifying..." : "Verify"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => {
                  setUseBackupCode(!useBackupCode);
                  setError(null);
                  setTotpCode("");
                  setBackupCode("");
                }}
              >
                {useBackupCode ? "Use authenticator app instead" : "Use a backup code instead"}
              </button>
              <button
                type="button"
                className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={goBack}
                disabled={pending}
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>
            </form>
          )}
        </SlideTransition>
      </CardContent>
    </Card>
  );
}
