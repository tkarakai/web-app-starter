import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import french from "@repo/i18n/messages/fr.json";
import { Footer } from "@/components/footer";

vi.mock("@repo/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));

describe("localized footer", () => {
  it("preserves the application's localized name and legal links", () => {
    const messages = { ...french, common: { ...french.common, appName: "Mon application" } };
    render(<NextIntlClientProvider locale="fr" messages={messages}><Footer /></NextIntlClientProvider>);
    expect(screen.getByText(/Mon application/)).toBeInTheDocument();
    expect(screen.queryByText(/Web App Starter/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: french.landing.footer.privacyPolicy })).toHaveAttribute("href", "/privacy");
  });
});
