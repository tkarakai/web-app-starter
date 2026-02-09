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
      className="relative min-h-screen"
      style={{ background: "var(--glow-warm-intense)" }}
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
        <AuthForm mode="sign-in" />
      </div>
    </main>
  );
}
