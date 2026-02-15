import { getTranslations } from "next-intl/server";

import { SiteHeader } from "@repo/design-patterns";
import { AuthForm } from "@/components/auth/auth-form";
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
      <SiteHeader appName={tc("appName")} homeHref={LANDING_URL} actions={<LocaleSwitcher />} />
      <div className="mx-auto grid flex-1 max-w-6xl items-start justify-items-center gap-12 px-6 pb-16 pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:justify-items-stretch">
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
        <AuthForm mode="sign-in" />
      </div>
    </main>
  );
}
