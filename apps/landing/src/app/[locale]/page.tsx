import { getTranslations } from "next-intl/server";

import { Badge, Button } from "@repo/design-system";
import { SiteHeader } from "@/components/site-header";
import { WaitlistSection } from "@/components/waitlist-section";

const WEB_APP_URL = process.env.WEB_APP_URL ?? "http://localhost:3001";
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL ?? "http://localhost:3210";

async function getWaitlistStatus(): Promise<boolean> {
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

export default async function HomePage() {
  const t = await getTranslations("landing");
  const waitlistEnabled = await getWaitlistStatus();

  return (
    <main
      className="relative flex min-h-screen items-center justify-center"
      style={{ background: "var(--glow-warm)" }}
    >
      <SiteHeader />
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-6 text-center">
        <Badge variant="secondary" className="text-xs uppercase tracking-widest">
          {t("badge")}
        </Badge>

        <h1 className="text-5xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
          {t("heading")}
          <br />
          {t("headingLine2")}
        </h1>

        <p className="max-w-lg text-base text-muted-foreground">
          {t("description")}
        </p>

        {waitlistEnabled ? (
          <WaitlistSection />
        ) : (
          <div className="flex gap-3">
            <Button asChild>
              <a href={`${WEB_APP_URL}/sign-up`}>{t("getStarted")}</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`${WEB_APP_URL}/sign-in`}>{t("signIn")}</a>
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
