"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { authClient, formatAuthError } from "@repo/auth/client";
import { broadcastAuth } from "@/lib/auth-broadcast";
import { redirectWithUserLocale } from "@/lib/auth-locale";
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
} from "@repo/design-system";

const LANDING_URL =
  process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3000";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("auth");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [twoFactorRequired, setTwoFactorRequired] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState("");
  const [useBackupCode, setUseBackupCode] = React.useState(false);
  const [backupCode, setBackupCode] = React.useState("");

  const isSignUp = mode === "sign-up";
  const namespace = isSignUp ? "signUp" : "signIn";

  const handleTwoFactorVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (useBackupCode && !backupCode.trim()) return;
    if (!useBackupCode && (!totpCode || totpCode.length !== 6)) return;

    setError(null);
    setPending(true);

    try {
      if (useBackupCode) {
        const result = await authClient.twoFactor.verifyBackupCode({
          code: backupCode.trim(),
        });
        if (result.error) {
          setError(t("twoFactorVerify.invalidCode"));
        } else {
          broadcastAuth();
          await redirectWithUserLocale(router);
        }
      } else {
        const result = await authClient.twoFactor.verifyTotp({
          code: totpCode,
        });
        if (result.error) {
          setError(t("twoFactorVerify.invalidCode"));
        } else {
          broadcastAuth();
          await redirectWithUserLocale(router);
        }
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (isSignUp && password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    setPending(true);

    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: "/dashboard",
        });

        if (result.error) {
          setError(formatAuthError(result.error, "Invalid email or password"));
        } else {
          broadcastAuth();
          await redirectWithUserLocale(router);
        }
        return;
      }

      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/dashboard",
        rememberMe: true,
      });

      if (result.error) {
        setError(formatAuthError(result.error, "Invalid email or password"));
      } else if (
        (result.data as Record<string, unknown> | undefined)?.twoFactorRedirect
      ) {
        setTwoFactorRequired(true);
      } else {
        broadcastAuth();
        await redirectWithUserLocale(router);
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  };

  if (twoFactorRequired) {
    return (
      <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            {t("badge")}
          </div>
          <CardTitle className="text-2xl font-semibold">
            {useBackupCode ? t("twoFactorVerify.backupCodeTitle") : t("twoFactorVerify.title")}
          </CardTitle>
          <CardDescription>
            {useBackupCode ? t("twoFactorVerify.backupCodeDescription") : t("twoFactorVerify.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleTwoFactorVerify}>
            {useBackupCode ? (
              <div className="space-y-2">
                <Label htmlFor="backup-code">{t("twoFactorVerify.backupCodeTitle")}</Label>
                <Input
                  id="backup-code"
                  placeholder={t("twoFactorVerify.backupCodePlaceholder")}
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  autoFocus
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="totp-code">{t("twoFactorVerify.title")}</Label>
                <Input
                  id="totp-code"
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
              </div>
            )}
            {error ? (
              <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                {error}
              </div>
            ) : null}
            <Button
              className="w-full"
              type="submit"
              disabled={pending || (useBackupCode ? !backupCode.trim() : totpCode.length !== 6)}
            >
              {pending ? t("working") : t("twoFactorVerify.cta")}
              <ArrowRight className="h-4 w-4" />
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
              {useBackupCode ? t("twoFactorVerify.useAuthenticator") : t("twoFactorVerify.useBackupCode")}
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
              {t("forgotPassword.backToSignIn")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          {t("badge")}
        </div>
        <CardTitle className="text-2xl font-semibold">
          {t(`${namespace}.title`)}
        </CardTitle>
        <CardDescription>{t(`${namespace}.description`)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {isSignUp ? (
            <div className="space-y-2">
              <Label htmlFor="name">{t("fields.name")}</Label>
              <Input
                id="name"
                name="name"
                placeholder={t("fields.namePlaceholder")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">{t("fields.email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t("fields.emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("fields.password")}</Label>
              {!isSignUp ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => router.push("/forgot-password")}
                >
                  {t("forgotPasswordLink")}
                </button>
              ) : null}
            </div>
            <PasswordInput
              id="password"
              name="password"
              placeholder={isSignUp ? t("fields.passwordSignUpPlaceholder") : t("fields.passwordPlaceholder")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              {...(isSignUp ? { minLength: 8 } : {})}
            />
          </div>
          {isSignUp ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("fields.confirmPassword")}</Label>
              <PasswordInput
                id="confirm-password"
                name="confirm-password"
                placeholder={t("fields.confirmPasswordPlaceholder")}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
              />
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
              {error}
            </div>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? t("working") : t(`${namespace}.cta`)}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1 min-w-0 w-auto" />
            <span>{t("footer")}</span>
            <Separator className="flex-1 min-w-0 w-auto" />
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => router.push(isSignUp ? "/sign-in" : "/sign-up")}
          >
            {t(`${namespace}.switchPrompt`)}{" "}
            <span className="underline">{t(`${namespace}.switchLink`)}</span>
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            {t("legal.prefix")}{" "}
            <a
              href={`${LANDING_URL}/${locale}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("legal.termsOfService")}
            </a>{" "}
            {t("legal.and")}{" "}
            <a
              href={`${LANDING_URL}/${locale}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("legal.privacyPolicy")}
            </a>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
