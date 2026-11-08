import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, test, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { BillingSection } from "../../src/settings/billing-section";

const mocks = vi.hoisted(() => ({ change: vi.fn(), canManage: true }));
const free = { id: "free", name: "Free", isFreeForever: true, priceMonthlyUsdCents: 0, isDefault: true };
const pro = { id: "pro", name: "Pro", isFreeForever: false, priceMonthlyUsdCents: 1900, isDefault: false };
vi.mock("convex/react", () => ({
  useQuery: () => ({
    mode: "organizations", organization: { id: "payer-org", name: "Payer", role: "owner" }, plan: null,
    plans: [free, pro], billingOrganizations: [], payer: null,
    billing: { id: "payer", paymentMethod: "cash", canManage: mocks.canManage, organizations: [{ organizationId: "sponsored-org", name: "Sponsored workspace", plan: pro }] },
  }),
  useMutation: () => mocks.change,
}));
vi.mock("../../src/components/create-organization-dialog", () => ({ CreateOrganizationDialog: () => null }));

test("a billing-only organization shows its payment method and create action without a current plan", () => {
  render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><BillingSection /></NextIntlClientProvider>);
  expect(screen.getByTestId("billing-organization")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: messages.billing.createAction })).toBeInTheDocument();
  expect(screen.queryByTestId("current-plan")).not.toBeInTheDocument();
});


test("a payer manager changes a sponsored plan without belonging to that workspace", async () => {
  mocks.canManage = true;
  render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><BillingSection /></NextIntlClientProvider>);
  const selector = screen.getByLabelText(messages.billing.changePlan);
  fireEvent.click(selector);
  fireEvent.click(await screen.findByRole("option", { name: /Free/ }));
  fireEvent.click(screen.getByRole("button", { name: messages.billing.changePlan }));
  await waitFor(() => expect(mocks.change).toHaveBeenCalledWith({ organizationId: "sponsored-org", planId: "free" }));
});

test("ordinary payer members see sponsored plans without change controls", () => {
  mocks.canManage = false;
  render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><BillingSection /></NextIntlClientProvider>);
  expect(screen.getByText("Sponsored workspace")).toBeInTheDocument();
  expect(screen.queryByLabelText(messages.billing.changePlan)).not.toBeInTheDocument();
});
