import { expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SidebarProvider } from "@web-app-starter/design-system";
import platform from "@web-app-starter/i18n/messages/en.json";
import app from "@repo/messages/en.json";

const mocks = vi.hoisted(() => ({ create: vi.fn(), toast: vi.fn(), select: vi.fn() }));
vi.mock("@repo/backend", () => ({ api: { projects: { list: "list", create: "create" }, platform: { userProfiles: { get: "get" } } } }));
vi.mock("convex/react", () => ({
  useQuery: () => null,
  usePaginatedQuery: () => ({ results: [], status: "Exhausted" }),
  useMutation: () => mocks.create,
}));
vi.mock("@web-app-starter/auth-ui", () => ({
  useAccountNavigation: () => ({ open: vi.fn() }),
  useOrganizations: () => ({ activeOrganizationId: "original-org" }),
  useTenancyMode: () => "organizations",
  useSignOut: () => vi.fn(),
  OrganizationSwitcher: () => null,
}));
vi.mock("@web-app-starter/design-patterns", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/app-logo", () => ({ AppLogo: () => null }));
vi.mock("@web-app-starter/design-system", async original => ({
  ...await original<typeof import("@web-app-starter/design-system")>(),
  toast: { error: mocks.toast },
}));

import { AppSidebar } from "../../src/components/projects/app-sidebar";

test("a redacted stale-workspace refusal closes the create dialog and explains how to retry", async () => {
  mocks.create.mockRejectedValue({ message: "[Request ID: hidden] Server Error", data: { code: "ORGANIZATION_CHANGED" } });
  render(<NextIntlClientProvider locale="en" messages={{ ...platform, ...app }}>
    <SidebarProvider><AppSidebar displayName="Alice" selectedProjectId={null} onSelectProject={mocks.select} /></SidebarProvider>
  </NextIntlClientProvider>);
  fireEvent.click(screen.getByTitle(app.projects.newProject));
  fireEvent.change(screen.getByLabelText(app.projects.fields.name), { target: { value: "My project" } });
  fireEvent.click(screen.getByRole("button", { name: app.projects.createProject }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(app.projects.organizationChanged));
  expect(mocks.create).toHaveBeenCalledWith({ name: "My project", description: "", expectedOrganizationId: "original-org" });
  expect(mocks.select).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
