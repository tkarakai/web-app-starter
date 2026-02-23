"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { api } from "@repo/backend";
import { authClient } from "@repo/auth/client";
import { broadcastAuth } from "@/lib/auth-broadcast";
import { EMAIL_VERIFICATION_CALLBACK_URL } from "@/lib/auth-callbacks";
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
  Skeleton,
} from "@repo/design-system";

export function InvitationSignupForm({ token }: { token?: string }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const ti = useTranslations("auth.invitation");

  // Validate token via Convex query (real-time)
  const tokenValidation = useQuery(
    api.waitlistTokens.validate,
    token ? { token } : "skip"
  );

  const beginClaim = useMutation(api.waitlistTokens.beginClaim);
  const finalizeClaim = useMutation(api.waitlistTokens.finalizeClaim);
  const releaseClaim = useMutation(api.waitlistTokens.releaseClaim);

  // Read admin setting so we know whether to gate unverified users after sign-up.
  const emailVerifRequired = useQuery(api.appSettings.getPublic, {
    key: "userEmailVerificationRequired",
  });

  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // No token provided
  if (!token) {
    return (
      <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {ti("invalidTitle")}
          </CardTitle>
          <CardDescription className="text-xl font-semibold leading-tight text-foreground">
            {ti("noToken")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Loading state
  if (tokenValidation === undefined) {
    return (
      <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
        <CardContent className="space-y-4 pt-6">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Invalid token
  if (!tokenValidation.valid) {
    const reasonMessages: Record<string, string> = {
      EXPIRED: ti("tokenExpired"),
      ALREADY_USED: ti("tokenUsed"),
      REVOKED: ti("tokenInvalid"),
      NOT_FOUND: ti("tokenInvalid"),
    };

    return (
      <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {ti("invalidTitle")}
          </CardTitle>
          <CardDescription className="text-xl font-semibold leading-tight text-foreground">
            {reasonMessages[tokenValidation.reason] ?? ti("tokenInvalid")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    setPending(true);

    try {
      // Step 1: Begin claim (sent → claiming)
      await beginClaim({ token });

      // Step 2: Create account via Better Auth
      const result = await authClient.signUp.email({
        name,
        email: tokenValidation.email,
        password,
        callbackURL: EMAIL_VERIFICATION_CALLBACK_URL,
      });

      if (result.error) {
        // Release claim on signup failure
        await releaseClaim({ token });
        // Use generic message to avoid leaking server error details.
        // Rate limit errors get a specific message.
        setError(
          result.error.status === 429
            ? t("errors.rateLimited")
            : t("errors.generic"),
        );
        return;
      }

      // Step 3: Finalize claim (claiming → claimed)
      await finalizeClaim({ token });

      broadcastAuth();

      // If email verification is required and the user isn't verified yet,
      // redirect to the verify-email page (same gate as the main sign-up form).
      const data = result.data as Record<string, unknown> | undefined;
      const newUser = data?.user as Record<string, unknown> | undefined;
      if (newUser && !newUser.emailVerified && emailVerifRequired === true) {
        router.push("/verify-email");
        return;
      }

      await redirectWithUserLocale(router);
    } catch {
      // Release claim on any error
      try {
        await releaseClaim({ token });
      } catch {
        // Ignore release errors
      }
      // Use generic message — don't leak internal error details to the client.
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          {ti("badge")}
        </div>
        <CardTitle className="text-2xl font-semibold">{ti("title")}</CardTitle>
        <CardDescription>{ti("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t("fields.email")}</Label>
            <Input
              id="invite-email"
              type="email"
              value={tokenValidation.email}
              readOnly
              className="bg-muted"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-name">{t("fields.name")}</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("fields.namePlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-password">{t("fields.password")}</Label>
            <PasswordInput
              id="invite-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("fields.passwordSignUpPlaceholder")}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-confirm-password">
              {t("fields.confirmPassword")}
            </Label>
            <PasswordInput
              id="invite-confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("fields.confirmPasswordPlaceholder")}
              required
              minLength={8}
            />
          </div>
          {error ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
              {error}
            </div>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? t("working") : ti("cta")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
