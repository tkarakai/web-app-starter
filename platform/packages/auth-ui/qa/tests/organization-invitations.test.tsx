import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "@web-app-starter/i18n/messages/en.json";
import { OrganizationInvitations } from "../../src/components/organization-invitations";

const mocks = vi.hoisted(() => ({ invitations: [] as unknown[], accept: vi.fn(), decline: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.invitations }));
vi.mock("@web-app-starter/auth/client", () => ({
  authClient: { organization: { acceptInvitation: mocks.accept, rejectInvitation: mocks.decline } },
}));

const invitations = [
  { id: "one", inviterName: "Ada", organizationName: "Alpha", emailVerified: true },
  { id: "two", inviterName: "Grace", organizationName: "Beta", emailVerified: true },
];
const view = () => <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><OrganizationInvitations /></NextIntlClientProvider>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invitations = invitations;
  mocks.accept.mockResolvedValue({ data: {} });
  mocks.decline.mockResolvedValue({ data: {} });
});

it("lists simultaneous invitations separately and declines the selected one", async () => {
  render(view());
  const rows = within(screen.getByRole("list", { name: "Invitations" })).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Ada invited you to join Alpha.");
  expect(rows[1]).toHaveTextContent("Grace invited you to join Beta.");
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Decline" }));
  await waitFor(() => expect(mocks.decline).toHaveBeenCalledWith({ invitationId: "two" }));
  expect(mocks.accept).not.toHaveBeenCalled();
});

it("accepts the chosen invitation and retains other invitations after the reactive update", async () => {
  const result = render(view());
  const first = screen.getAllByRole("listitem")[0]!;
  fireEvent.click(within(first).getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith({ invitationId: "one" }));
  mocks.invitations = invitations.slice(1);
  result.rerender(view());
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("listitem")).toHaveTextContent("Beta");
});
