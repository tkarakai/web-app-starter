import type { Metadata } from "next";

import { ContentPageLayout } from "@/components/content-page-layout";

export const metadata: Metadata = {
  title: "Terms of Service - Web App Starter",
};

export default function TermsPage() {
  return (
    <ContentPageLayout
      title="Terms of Service"
      notice="This is placeholder content. Replace it with your actual terms of service before launching."
    >
      <p className="italic">Last updated: February 2026</p>

      <h2 className="text-lg font-semibold text-foreground">
        Acceptance of Terms
      </h2>
      <p>
        By accessing or using Web App Starter, you agree to be bound by these
        terms of service. If you do not agree, please do not use the service.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        Use of the Service
      </h2>
      <p>
        You may use the service for lawful purposes only. You are responsible
        for maintaining the confidentiality of your account credentials and for
        all activity that occurs under your account.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        Intellectual Property
      </h2>
      <p>
        The service and its original content, features, and functionality are
        owned by the project maintainers and are protected by applicable
        intellectual property laws.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        Limitation of Liability
      </h2>
      <p>
        The service is provided on an &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo; basis. We make no warranties, expressed or implied, and
        hereby disclaim all warranties including, without limitation, implied
        warranties of merchantability and fitness for a particular purpose.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        Changes to Terms
      </h2>
      <p>
        We reserve the right to modify these terms at any time. Continued use of
        the service after changes constitutes acceptance of the updated terms.
      </p>
    </ContentPageLayout>
  );
}
