"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, usePublicConfig } from "@web-app-starter/design-system";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface WaitlistFormProps {
  /** Runtime Convex HTTP origin. Post directly from the visitor's browser for IP limiting. */
  convexSiteUrl: string;
  /** Optional app-owned questions and answers; no sample fields are required. */
  children?: React.ReactNode;
  meta?: Record<string, JsonValue>;
  disabled?: boolean;
}

/** Shared waitlist transport, localized feedback and card; apps own the questions. */
export function WaitlistForm({ convexSiteUrl, meta = {}, children, disabled = false }: WaitlistFormProps) {
  const locale = useLocale();
  const { landingUrl } = usePublicConfig();
  const t = useTranslations("auth.waitlist");
  const tAuth = useTranslations("auth");
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch(`${convexSiteUrl}/api/waitlist/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          meta: JSON.stringify(meta),
        }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        const raw = typeof data.error === "string" ? data.error : "";
        if (raw.includes("WAITLIST_NOT_ENABLED")) {
          setError(t("errors.waitlistNotEnabled"));
        } else if (raw.includes("INVALID_EMAIL")) {
          setError(t("errors.invalidEmail"));
        } else if (raw.includes("RATE_LIMITED")) {
          setError(t("errors.rateLimited"));
        } else {
          setError(t("errors.generic"));
        }
        return;
      }

      setSuccess(true);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setPending(false);
    }
  };

  if (success) {
    return (
      <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
        <CardHeader className="text-center">
          <CardTitle>{t("successTitle")}</CardTitle>
          <CardDescription>{t("successDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div className="space-y-2">
            <Label htmlFor="waitlist-email">{t("emailLabel")}</Label>
            <Input
              id="waitlist-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              required
            />
          </div>
          {children}
          {error ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
              {error}
            </div>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={pending || disabled}
          >
            {pending ? t("submitting") : t("submit")}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            {tAuth("legal.prefix")}{" "}
            <a
              href={`${landingUrl}/${locale}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {tAuth("legal.termsOfService")}
            </a>{" "}
            {tAuth("legal.and")}{" "}
            <a
              href={`${landingUrl}/${locale}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {tAuth("legal.privacyPolicy")}
            </a>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
