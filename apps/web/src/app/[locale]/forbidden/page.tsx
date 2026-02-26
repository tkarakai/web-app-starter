import { getTranslations } from "next-intl/server";

import { Button } from "@repo/design-system";

export default async function ForbiddenPage() {
  const t = await getTranslations("forbidden");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-4xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
        <Button asChild variant="outline">
          <a href="/api/auth/clear-session">{t("backToSignIn")}</a>
        </Button>
      </div>
    </main>
  );
}
