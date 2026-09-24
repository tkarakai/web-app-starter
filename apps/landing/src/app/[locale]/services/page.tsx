import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/design-system";
import { SiteHeader } from "@/components/site-header";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.pages.services" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function ServicesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("landing.pages.services");

  return (
    <main className="relative min-h-screen bg-[radial-gradient(circle_at_20%_20%,var(--glow-warm),transparent_55%),radial-gradient(circle_at_80%_80%,var(--glow-cool),transparent_45%)]">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-20 pt-[calc(6.5rem+var(--announcement-banner-h,0px))]">
        <section className="space-y-5 text-center">
          <Badge variant="secondary" className="text-xs uppercase tracking-[0.2em]">
            {t("title")}
          </Badge>
          <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
            Productized services built on this exact codebase.
          </h1>
          <p className="mx-auto max-w-3xl text-pretty text-base text-muted-foreground sm:text-lg">
            {t("description")} Every package has fixed scope, clear exclusions,
            and delivery milestones that map directly to repository modules.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <Card className="border-border/60 bg-card/85">
            <CardHeader>
              <CardTitle>Launch in 2 Weeks</CardTitle>
              <CardDescription>$6,500 fixed fee</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Scope</p>
              <ul className="space-y-1">
                <li>Production deployment setup (staging + production)</li>
                <li>Branding pass across landing/web/admin</li>
                <li>Auth and onboarding policy configuration</li>
              </ul>
              <p className="pt-2">Exclusions: custom billing domain logic, bespoke third-party APIs.</p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/85">
            <CardHeader>
              <CardTitle>Security Hardening</CardTitle>
              <CardDescription>$3,200 fixed fee</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Scope</p>
              <ul className="space-y-1">
                <li>Policy review for MFA, passkeys, and email verification</li>
                <li>CSP and rate-limit tuning for target traffic profile</li>
                <li>Threat-model notes and remediation checklist</li>
              </ul>
              <p className="pt-2">Exclusions: external penetration tests and compliance certifications.</p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/85">
            <CardHeader>
              <CardTitle>i18n + Admin Setup</CardTitle>
              <CardDescription>$2,700 fixed fee</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Scope</p>
              <ul className="space-y-1">
                <li>Locale rollout strategy and translation key mapping</li>
                <li>Admin feature controls and onboarding queue workflows</li>
                <li>Operational handoff runbook for your internal team</li>
              </ul>
              <p className="pt-2">Exclusions: copywriting in all locales and ongoing translation operations.</p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
