import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/design-system";
import { SiteHeader } from "@/components/site-header";

type Props = {
  params: Promise<{ locale: string }>;
};

const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL ?? "http://localhost:3001";
const ADMIN_APP_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
const STORYBOOK_URL = process.env.NEXT_PUBLIC_STORYBOOK_URL ?? "http://localhost:3003";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.pages.demo" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function DemoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("landing.pages.demo");

  return (
    <main className="relative min-h-screen bg-[radial-gradient(circle_at_center,var(--glow-cool),transparent_60%),linear-gradient(180deg,var(--background),var(--background))]">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-20 pt-[calc(6.5rem+var(--announcement-banner-h,0px))]">
        <section className="space-y-5 text-center">
          <Badge variant="secondary" className="text-xs uppercase tracking-[0.2em]">
            {t("title")}
          </Badge>
          <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
            Explore the stack before you buy.
          </h1>
          <p className="mx-auto max-w-3xl text-pretty text-base text-muted-foreground sm:text-lg">
            {t("description")} Run the live surfaces below to review user onboarding,
            admin controls, and reusable UI foundations.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          <Card className="border-border/60 bg-card/85">
            <CardHeader>
              <CardTitle>Web App</CardTitle>
              <CardDescription>Auth, projects, tasks, uploads, and session controls.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" asChild>
                <a href={WEB_APP_URL} target="_blank" rel="noreferrer">
                  Open web app
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/85">
            <CardHeader>
              <CardTitle>Admin App</CardTitle>
              <CardDescription>Security policy controls, onboarding queue, and user management.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" asChild>
                <a href={ADMIN_APP_URL} target="_blank" rel="noreferrer">
                  Open admin app
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/85">
            <CardHeader>
              <CardTitle>Storybook</CardTitle>
              <CardDescription>Design-system foundations and component showcase.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" asChild>
                <a href={STORYBOOK_URL} target="_blank" rel="noreferrer">
                  Open storybook
                </a>
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
