import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import platformFrench from "@web-app-starter/i18n/messages/fr.json";
import appFrench from "@repo/messages/fr.json";
import { Footer } from "@/components/footer";

// Platform and app namespaces, as the app loads them.
const french = { ...platformFrench, ...appFrench };

vi.mock("@web-app-starter/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));

// Renaming the owner is an app.config.ts change, not a translation change.
vi.mock("@web-app-starter/app-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@web-app-starter/app-config")>();
  return {
    ...original,
    appConfig: {
      ...original.appConfig,
      identity: { ...original.appConfig.identity, legalEntity: "Mon entreprise SARL" },
    },
  };
});

describe("localized footer", () => {
  it("shows the configured legal entity with the localized legal links", () => {
    render(<NextIntlClientProvider locale="fr" messages={french}><Footer /></NextIntlClientProvider>);
    expect(screen.getByText(/Mon entreprise SARL/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: french.landing.footer.privacyPolicy })).toHaveAttribute("href", "/privacy");
  });
});
