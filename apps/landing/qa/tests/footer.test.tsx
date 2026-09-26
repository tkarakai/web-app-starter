import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import french from "@repo/i18n/messages/fr.json";
import { Footer } from "@/components/footer";

vi.mock("@repo/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));

// Renaming the owner is an app.config.ts change, not a translation change.
vi.mock("@repo/app-config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@repo/app-config")>();
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
