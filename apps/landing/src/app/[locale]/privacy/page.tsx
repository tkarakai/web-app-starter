import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ContentPageLayout } from "@/components/content-page-layout";

type Props = {
  params: Promise<{ locale: string }>;
};

const LAST_UPDATED = "February 25, 2026";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.privacy" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("legal.privacy");

  return (
    <ContentPageLayout title={t("heading")}>
      <p>{t("lastUpdated", { date: LAST_UPDATED })}</p>

      <h2 className="text-lg font-semibold text-foreground">Information We Collect</h2>
      <p>
        We collect information you provide directly, such as account details,
        profile information, and support messages. We also collect limited
        technical data required to operate and secure the service.
      </p>

      <h2 className="text-lg font-semibold text-foreground">How We Use Information</h2>
      <p>
        We use data to provide the service, secure accounts, prevent abuse,
        process transactions, improve product quality, and communicate relevant
        service updates.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Legal Bases</h2>
      <p>
        Depending on jurisdiction, we process data based on contract necessity,
        legitimate interests, legal obligations, and consent where required.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Sharing of Information</h2>
      <p>
        We share data only with service providers that support hosting,
        authentication, payments, communications, and analytics. We do not sell
        personal data.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Data Retention</h2>
      <p>
        We retain data for as long as needed to deliver the service, comply with
        legal obligations, resolve disputes, and enforce agreements.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Security</h2>
      <p>
        We use technical and organizational safeguards to protect data, but no
        system can be guaranteed completely secure.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Your Rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct,
        delete, or export your data, and to object to certain processing.
      </p>

      <h2 className="text-lg font-semibold text-foreground">International Transfers</h2>
      <p>
        Data may be processed in countries other than your own. When required,
        we apply appropriate safeguards for cross-border transfers.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Policy Updates</h2>
      <p>
        We may update this policy from time to time. Material updates are
        reflected by changing the "last updated" date and, when required,
        notifying users.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Contact</h2>
      <p>
        For privacy requests, use the support channel listed in your account,
        invoice, or project documentation.
      </p>
    </ContentPageLayout>
  );
}
