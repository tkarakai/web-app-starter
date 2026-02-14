"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system";

const INDUSTRIES = [
  "technology",
  "healthcare",
  "finance",
  "education",
  "retail",
  "manufacturing",
  "media",
  "government",
  "nonprofit",
  "other",
] as const;

export function WaitlistForm() {
  const t = useTranslations("landing.waitlist");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          meta: JSON.stringify({ industry }),
        }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Something went wrong"
        );
        return;
      }

      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
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
            <Label htmlFor="waitlist-name">{t("nameLabel")}</Label>
            <Input
              id="waitlist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              required
            />
          </div>
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
          <div className="space-y-2">
            <Label htmlFor="waitlist-industry">{t("industryLabel")}</Label>
            <Select value={industry} onValueChange={setIndustry} required>
              <SelectTrigger id="waitlist-industry">
                <SelectValue placeholder={t("industryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((ind) => (
                  <SelectItem key={ind} value={ind}>
                    {t(`industries.${ind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
              {error}
            </div>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={pending || !industry}
          >
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
