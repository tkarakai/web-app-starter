"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail, RefreshCw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { authClient, formatAuthError } from "@repo/auth/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@repo/design-system";

export function VerifyEmailForm() {
  const router = useRouter();
  const tv = useTranslations("auth.verifyEmail");
  const t = useTranslations("auth");
  const [resending, setResending] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleResend = async () => {
    setError(null);
    setResending(true);
    setResent(false);

    try {
      const result = await authClient.sendVerificationEmail({
        email: "", // Better Auth uses the current session's email
        callbackURL: "/dashboard",
      });

      if (result.error) {
        setError(formatAuthError(result.error, "Could not resend verification email. Please try again."));
      } else {
        setResent(true);
      }
    } catch {
      setError("Could not resend verification email. Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          {tv("badge")}
        </div>
        <div className="flex justify-center py-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-center text-2xl font-semibold">
          {tv("title")}
        </CardTitle>
        <CardDescription className="text-center">
          {tv("description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
            {error}
          </div>
        ) : null}
        {resent ? (
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
            {tv("resent")}
          </div>
        ) : null}
        <Button
          className="w-full"
          variant="outline"
          onClick={handleResend}
          disabled={resending}
        >
          <RefreshCw className={`h-4 w-4 ${resending ? "animate-spin" : ""}`} />
          {resending ? t("working") : tv("resend")}
        </Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1 min-w-0 w-auto" />
          <span>{t("footer")}</span>
          <Separator className="flex-1 min-w-0 w-auto" />
        </div>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => router.push("/sign-in")}
        >
          <ArrowLeft className="h-4 w-4" />
          {tv("backToSignIn")}
        </Button>
      </CardContent>
    </Card>
  );
}
