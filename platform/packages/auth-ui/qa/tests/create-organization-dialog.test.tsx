import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, test, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { CreateOrganizationDialog } from "../../src/components/create-organization-dialog";

const mocks = vi.hoisted(() => ({ create: vi.fn(), activate: vi.fn(), success: vi.fn(), error: vi.fn(), close: vi.fn(), created: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.create }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: { organization: { setActive: mocks.activate } } }));
vi.mock("@web-app-starter/design-system", async original => ({
  ...await original<typeof import("@web-app-starter/design-system")>(), toast: { success: mocks.success, error: mocks.error },
}));
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ organizationId: "new-org" }); });

test.each(["resolved-error", "rejected"])("creation survives %s activation and retries without duplicates", async kind => {
  if (kind === "resolved-error") mocks.activate.mockResolvedValueOnce({ error: { message: "Session changed" } });
  else mocks.activate.mockRejectedValueOnce(new Error("Network unavailable"));
  mocks.activate.mockResolvedValueOnce({ data: { id: "new-org" }, error: null });
  render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <CreateOrganizationDialog open onOpenChange={mocks.close} onCreated={mocks.created} billingOrganizationId="payer" billingName="Payer" plans={[{ id: "free", name: "Free", isFreeForever: true, isDefault: true, priceMonthlyUsdCents: 0 }]} />
  </NextIntlClientProvider>);
  fireEvent.change(screen.getByLabelText(messages.billing.createNameLabel), { target: { value: "New workspace" } });
  fireEvent.click(screen.getByRole("button", { name: messages.billing.createAction }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(screen.getByLabelText(messages.billing.createNameLabel)).toHaveValue("New workspace");
  expect(screen.getByRole("status")).toHaveTextContent("New workspace was created");
  fireEvent.click(screen.getByRole("button", { name: messages.billing.retryActivation }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.created).toHaveBeenCalledTimes(1);
  expect(mocks.activate).toHaveBeenNthCalledWith(2, { organizationId: "new-org" });
  expect(mocks.success).toHaveBeenCalledTimes(1);
});
