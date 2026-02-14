import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system";
import { AuthForm } from "@/components/auth/auth-form";
import { AppLogo } from "@/components/app-logo";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";

const LANDING_URL = process.env.LANDING_URL ?? "http://localhost:3000";
const CONVEX_SITE_URL =
  process.env.CONVEX_SITE_URL ?? "http://localhost:3210";

async function getWaitlistEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${CONVEX_SITE_URL}/api/waitlist/status`, {
      next: { revalidate: 60 },
    });
    const data = (await res.json()) as { enabled?: boolean };
    return data.enabled === true;
  } catch {
    return false;
  }
}

export default async function SignUpPage() {
  const t = await getTranslations("auth.signUp");
  const tc = await getTranslations("common");
  const ti = await getTranslations("auth.invitation");
  const waitlistEnabled = await getWaitlistEnabled();

  return (
    <main
      className="relative min-h-screen"
      style={{ background: "var(--glow-cool)" }}
    >
      <Link
        href={LANDING_URL}
        className="absolute start-6 top-6 flex items-center gap-2 text-sm font-semibold text-foreground transition-opacity hover:opacity-80"
      >
        <AppLogo size={24} />
        <span>{tc("appName")}</span>
      </Link>
      <LocaleSwitcher className="absolute end-6 top-6" />
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            {tc("appName")}
          </p>
          <h1 className="text-4xl font-semibold leading-tight">
            {t("pageHeading")}
          </h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            {t("pageDescription")}
          </p>
        </section>
        {waitlistEnabled ? (
          <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
            <CardHeader>
              <CardTitle>{ti("signupBlocked")}</CardTitle>
              <CardDescription>
                {ti("signupBlockedDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href={LANDING_URL}>{ti("goToWaitlist")}</a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <AuthForm mode="sign-up" landingUrl={LANDING_URL} />
        )}
      </div>
    </main>
  );
}
