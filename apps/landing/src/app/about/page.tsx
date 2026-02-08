import type { Metadata } from "next";

import { ContentPageLayout } from "@/components/content-page-layout";

export const metadata: Metadata = {
  title: "About - Web App Starter",
};

export default function AboutPage() {
  return (
    <ContentPageLayout
      title="About"
      notice="This is placeholder content. Replace it with your own before launching."
    >
      <p>
        Web App Starter is a full-stack foundation for building modern web
        applications. It combines Next.js for the frontend, Convex for the
        backend, and Better Auth for secure authentication — all wired together
        and ready to ship.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Our Mission</h2>
      <p>
        We believe developers should spend their time building features, not
        configuring infrastructure. Web App Starter provides a production-ready
        starting point with real-time data sync, file uploads, and session-based
        authentication out of the box.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        What&apos;s Included
      </h2>
      <p>
        The starter kit ships with a landing page, a fully authenticated web
        application, an admin dashboard, and a component storybook. Each app
        shares a unified design system built on Radix UI primitives with
        Tailwind CSS.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Open Source</h2>
      <p>
        This project is open source and designed to be forked and customised.
      </p>
    </ContentPageLayout>
  );
}
