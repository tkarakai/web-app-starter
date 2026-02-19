"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { authClient, formatAuthError } from "@repo/auth/client";
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
} from "@repo/design-system";

export function AdminSignInForm() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // 2FA challenge state
  const [twoFactorRequired, setTwoFactorRequired] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState("");
  const [useBackupCode, setUseBackupCode] = React.useState(false);
  const [backupCode, setBackupCode] = React.useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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
        setTwoFactorRequired(true);
      } else {
        broadcastAuth();
        router.push("/dashboard");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

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
          broadcastAuth();
          router.push("/dashboard");
        }
      } else {
        const result = await authClient.twoFactor.verifyTotp({ code: totpCode });
        if (result.error) {
          setError(formatAuthError(result.error, "Invalid verification code"));
        } else {
          broadcastAuth();
          router.push("/dashboard");
        }
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  if (twoFactorRequired) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            {useBackupCode ? "Backup code" : "Two-factor authentication"}
          </CardTitle>
          <CardDescription>
            {useBackupCode
              ? "Enter one of your backup codes to sign in."
              : "Enter the 6-digit code from your authenticator app."}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setTwoFactorRequired(false);
                setUseBackupCode(false);
                setTotpCode("");
                setBackupCode("");
                setError(null);
              }}
            >
              Back to sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Sign in</CardTitle>
        <CardDescription>Admin access only.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
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
            />
          </div>
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
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
