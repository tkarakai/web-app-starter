import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/design-system";
import { SiteHeader } from "@/components/site-header";

type Props = {
  params: Promise<{ locale: string }>;
};

const STARTER_CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_STARTER_URL ?? "#";
const PRO_CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_PRO_URL ?? "#";
const TEAM_CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_TEAM_URL ?? "#";
const CONTACT_URL = process.env.NEXT_PUBLIC_CONTACT_URL ?? "mailto:sales@example.com";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.pages.pricing" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("landing.pages.pricing");

  return (
    <main className="relative min-h-screen bg-[radial-gradient(circle_at_top_right,var(--glow-cool),transparent_55%),radial-gradient(circle_at_bottom_left,var(--glow-warm),transparent_50%)]">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-20 pt-[calc(6.5rem+var(--announcement-banner-h,0px))]">
        <section className="space-y-5 text-center">
          <Badge variant="secondary" className="text-xs uppercase tracking-[0.2em]">
            {t("title")}
          </Badge>
          <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
            Monetize faster with a production-grade starter.
          </h1>
          <p className="mx-auto max-w-3xl text-pretty text-base text-muted-foreground sm:text-lg">
            {t("description")} Choose the license that matches your delivery model,
            from single-project shipping to multi-client productized services.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          <Card className="border-border/60 bg-card/80">
            <CardHeader>
              <CardTitle>Starter</CardTitle>
              <CardDescription>Single production project</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-4xl font-semibold">$199</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Commercial rights for one production app</li>
                <li>Security and bug-fix updates</li>
                <li>Email support within 72 business hours</li>
              </ul>
              <Button className="w-full" asChild>
                <a href={STARTER_CHECKOUT_URL}>Buy Starter</a>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-primary/40 bg-card/95 shadow-xl shadow-primary/15">
            <CardHeader>
              <Badge className="w-fit">Most Popular</Badge>
              <CardTitle>Pro</CardTitle>
              <CardDescription>Up to three production projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-4xl font-semibold">$399</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Everything in Starter</li>
                <li>Priority issue handling</li>
                <li>Bonus onboarding checklist and launch templates</li>
              </ul>
              <Button className="w-full" asChild>
                <a href={PRO_CHECKOUT_URL}>Buy Pro</a>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80">
            <CardHeader>
              <CardTitle>Team</CardTitle>
              <CardDescription>Unlimited projects, one legal entity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-4xl font-semibold">$799</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Everything in Pro</li>
                <li>Priority support lane and architecture reviews</li>
                <li>Best fit for agencies and internal platform teams</li>
              </ul>
              <Button className="w-full" asChild>
                <a href={TEAM_CHECKOUT_URL}>Buy Team</a>
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 rounded-2xl border border-border/60 bg-background/75 p-6 backdrop-blur sm:grid-cols-2">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Need a done-for-you launch?</h2>
            <p className="text-sm text-muted-foreground">
              Add the Launch Sprint implementation package to ship your first customer-ready
              version in two focused weeks.
            </p>
          </div>
          <div className="flex items-center justify-start sm:justify-end">
            <Button variant="outline" asChild>
              <a href={CONTACT_URL}>Talk to sales</a>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
