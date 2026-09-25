import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ContentPageLayout } from "@/components/content-page-layout";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.terms" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("legal.terms");

  return (
    <ContentPageLayout title={t("heading")} notice={t("notice")}>
      <p>{t("description")}</p>
    </ContentPageLayout>
  );
}
