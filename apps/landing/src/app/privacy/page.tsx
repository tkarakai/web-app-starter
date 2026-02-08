import type { Metadata } from "next";

import { ContentPageLayout } from "@/components/content-page-layout";

export const metadata: Metadata = {
  title: "Privacy Policy - Web App Starter",
};

export default function PrivacyPage() {
  return (
    <ContentPageLayout
      title="Privacy Policy"
      notice="This is placeholder content. Replace it with your actual privacy policy before launching."
    >
      <p className="italic">Last updated: February 2026</p>

      <h2 className="text-lg font-semibold text-foreground">
        Information We Collect
      </h2>
      <p>
        When you create an account, we collect your name, email address, and a
        securely hashed password. We do not sell or share your personal
        information with third parties.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        How We Use Your Information
      </h2>
      <p>
        Your information is used solely to provide and improve the service. This
        includes authenticating your sessions, personalising your experience,
        and sending essential account notifications.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        Data Storage and Security
      </h2>
      <p>
        All data is stored securely using Convex&apos;s managed infrastructure.
        Passwords are hashed using industry-standard algorithms and are never
        stored in plain text.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Cookies</h2>
      <p>
        We use a session cookie to keep you signed in. No third-party tracking
        cookies are used.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Contact</h2>
      <p>
        If you have questions about this privacy policy, please reach out via
        the contact information on our website.
      </p>
    </ContentPageLayout>
  );
}
