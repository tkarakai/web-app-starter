import { useTranslations } from "next-intl";
import { Button } from "@repo/design-system";

import { WaitlistForm } from "./waitlist-form";

const WEB_APP_URL =
  process.env.NEXT_PUBLIC_WEB_APP_URL ?? "http://localhost:3001";

export function WaitlistSection() {
  const t = useTranslations("landing.waitlist");

  return (
    <div className="flex flex-col items-center gap-4">
      <WaitlistForm />
      <p className="text-sm text-muted-foreground">
        {t("alreadySignedUp")}{" "}
        <Button variant="link" asChild className="h-auto p-0 text-sm">
          <a href={`${WEB_APP_URL}/sign-in`}>{t("signIn")}</a>
        </Button>
      </p>
    </div>
  );
}
