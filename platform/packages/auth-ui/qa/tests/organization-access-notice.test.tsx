import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { OrganizationAccessNotice } from "../../src/components/organization-invitations";

const mocks = vi.hoisted(() => ({ mine: undefined as unknown, setActive: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.mine }));
vi.mock("@web-app-starter/auth/client", () => ({
  authClient: { organization: { setActive: mocks.setActive } },
  isAuthRateLimited: () => false,
}));
vi.mock("@web-app-starter/design-system", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

const view = () => <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><OrganizationAccessNotice /></NextIntlClientProvider>;
const organization = (id: string) => ({ id, name: id, role: "member" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setActive.mockResolvedValue({ data: {} });
});

it("switches a stale session to the organization the page shows, once", async () => {
  mocks.mine = { activeOrganizationId: "shared", selectionStale: true, organizations: [organization("shared")] };
  const result = render(view());
  await waitFor(() => expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: "shared" }));
  mocks.mine = { ...(mocks.mine as object) };
  result.rerender(view());
  expect(mocks.setActive).toHaveBeenCalledTimes(1);
});

it("clears a stale selection when no organization is left", async () => {
  mocks.mine = { activeOrganizationId: null, selectionStale: true, organizations: [] };
  render(view());
  await waitFor(() => expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: null }));
});

it("leaves a valid selection alone", () => {
  mocks.mine = { activeOrganizationId: "shared", selectionStale: false, organizations: [organization("shared")] };
  render(view());
  expect(mocks.setActive).not.toHaveBeenCalled();
});
