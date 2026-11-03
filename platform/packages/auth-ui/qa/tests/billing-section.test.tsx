import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, test, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { BillingSection } from "../../src/settings/billing-section";

vi.mock("convex/react", () => ({
  useQuery: () => ({
    mode: "organizations", organization: { id: "payer-org", name: "Payer", role: "owner" }, plan: null,
    plans: [], billingOrganizations: [], payer: null,
    billing: { id: "payer", paymentMethod: "cash", canManage: true, organizations: [] },
  }),
  useMutation: () => vi.fn(),
}));
vi.mock("../../src/components/create-organization-dialog", () => ({ CreateOrganizationDialog: () => null }));

test("a billing-only organization shows its payment method and create action without a current plan", () => {
  render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><BillingSection /></NextIntlClientProvider>);
  expect(screen.getByTestId("billing-organization")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: messages.billing.createAction })).toBeInTheDocument();
  expect(screen.queryByTestId("current-plan")).not.toBeInTheDocument();
});
