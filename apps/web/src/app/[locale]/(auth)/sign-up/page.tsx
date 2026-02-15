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

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3000";
const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "http://localhost:3210";

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
      className="flex min-h-screen flex-col"
      style={{ background: "var(--glow-cool)" }}
    >
      <header className="sticky top-[var(--env-banner-h,0px)] z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-4">
          <Link
            href={LANDING_URL}
            className="flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-muted-foreground"
          >
            <AppLogo size={24} />
            <span>{tc("appName")}</span>
          </Link>
          <LocaleSwitcher />
        </div>
      </header>
      <div className="mx-auto grid flex-1 max-w-6xl items-start justify-items-center gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:justify-items-stretch">
        <section className="w-full max-w-md space-y-6 lg:max-w-none">
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
          <AuthForm mode="sign-up" />
        )}
      </div>
    </main>
  );
}
