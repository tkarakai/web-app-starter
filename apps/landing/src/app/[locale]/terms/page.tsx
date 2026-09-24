import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ContentPageLayout } from "@/components/content-page-layout";

type Props = {
  params: Promise<{ locale: string }>;
};

const LAST_UPDATED = "February 25, 2026";

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
    <ContentPageLayout title={t("heading")}>
      <p>{t("lastUpdated", { date: LAST_UPDATED })}</p>

      <h2 className="text-lg font-semibold text-foreground">Acceptance of Terms</h2>
      <p>
        By accessing or using this service, you agree to these Terms of Service.
        If you are using the service on behalf of an organization, you represent
        that you have authority to bind that organization.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Use of the Service</h2>
      <p>
        You may use the service only for lawful purposes and in compliance with
        applicable laws. You are responsible for activity performed under your
        account and for protecting your credentials.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Accounts and Security</h2>
      <p>
        You must provide accurate account information and maintain the security
        of your account. We may suspend access when we detect abuse, fraud, or
        significant security risk.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Intellectual Property</h2>
      <p>
        The service, its code, documentation, and design assets are owned by the
        operator or its licensors and are protected by copyright and other laws.
        Your rights to use software deliverables are governed by the applicable
        license terms included with your purchase.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Payments and Subscriptions</h2>
      <p>
        Paid plans, add-ons, and support subscriptions are billed according to
        the checkout terms and invoice details. Failure to pay may result in
        suspension or termination of paid features.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Disclaimer</h2>
      <p>
        The service is provided on an "as is" and "as available" basis without
        warranties of any kind, to the extent permitted by law.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, the operator will not be liable
        for indirect, incidental, special, consequential, or punitive damages,
        or any loss of profits, data, or goodwill arising from your use of the
        service.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Changes to These Terms</h2>
      <p>
        We may update these terms from time to time. Material changes will be
        reflected by updating the "last updated" date and, when appropriate,
        through in-product or email notice.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Contact</h2>
      <p>
        For questions about these terms, use the support channel listed in your
        account, invoice, or project documentation.
      </p>
    </ContentPageLayout>
  );
}
