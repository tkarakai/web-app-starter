"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { authClient } from "@repo/auth/client";
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
  Separator,
} from "@repo/design-system";

const LANDING_URL =
  process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3000";

type AuthMode = "sign-in" | "sign-up";

function formatAuthError(error: { status?: number; message?: string }): string {
  if (error.status === 429) {
    return "Too many attempts. Please wait a moment before trying again.";
  }
  return error.message ?? "An error occurred";
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  const isSignUp = mode === "sign-up";
  const namespace = isSignUp ? "signUp" : "signIn";

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
          setError(formatAuthError(result.error));
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
        setError(formatAuthError(result.error));
      } else {
        broadcastAuth();
        await redirectWithUserLocale(router);
      }
    } finally {
      setPending(false);
    }
  };

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
            <Label htmlFor="password">{t("fields.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
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
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
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
              href={`${LANDING_URL}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("legal.termsOfService")}
            </a>{" "}
            {t("legal.and")}{" "}
            <a
              href={`${LANDING_URL}/privacy`}
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
