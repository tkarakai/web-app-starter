import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AuthForm } from "@/components/auth/auth-form";
import { AppLogo } from "@/components/app-logo";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3000";

export default async function SignInPage() {
  const t = await getTranslations("auth.signIn");
  const tc = await getTranslations("common");

  return (
    <main
      className="flex min-h-screen flex-col"
      style={{ background: "var(--glow-warm-intense)" }}
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
      <div className="mx-auto grid flex-1 max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
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
        <AuthForm mode="sign-in" />
      </div>
    </main>
  );
}
