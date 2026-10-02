import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import platform from "@web-app-starter/i18n/messages/en.json";
import app from "@repo/messages/en.json";

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  upsertProfile: vi.fn(),
  postAuditEvent: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// The mutations are told apart by the function reference they were called with.
vi.mock("@repo/backend", () => ({
  api: { platform: { userProfiles: { get: "get", upsert: "upsert", setLocale: "setLocale" }, auditTrail: { postEvent: "postEvent" } } },
}));
vi.mock("convex/react", () => ({
  useQuery: () => null,
  useMutation: (reference: string) => ({ upsert: mocks.upsertProfile, postEvent: mocks.postAuditEvent, setLocale: vi.fn() }[reference]),
}));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: { updateUser: mocks.updateUser } }));
vi.mock("@web-app-starter/auth-ui", () => ({ useAuthUser: () => ({ name: "Ada Lovelace", email: "ada@example.test" }) }));
vi.mock("@web-app-starter/design-patterns", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/ui/localized-controls", () => ({ TimezoneSelector: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/en/dashboard/settings", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark" }) }));
vi.mock("@web-app-starter/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@web-app-starter/design-system")>()),
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { ProfileSection } from "../../src/components/settings/profile-section";

const messages = { ...platform, ...app };

async function saveWithNewName() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProfileSection />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText(messages.dashboard.profile.name), { target: { value: "Grace Hopper" } });
  fireEvent.click(screen.getByRole("button", { name: messages.common.save }));
  await waitFor(() => expect(mocks.postAuditEvent).toHaveBeenCalledTimes(1));
  return mocks.postAuditEvent.mock.calls[0][0];
}

describe("profile section name update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsertProfile.mockResolvedValue(undefined);
    mocks.postAuditEvent.mockResolvedValue(undefined);
  });

  it("reports a rejected name update as a failure and does not save preferences", async () => {
    mocks.updateUser.mockResolvedValue({ data: null, error: { status: 400, message: "Name rejected" } });

    const audit = await saveWithNewName();

    expect(mocks.updateUser).toHaveBeenCalledWith({ name: "Grace Hopper" });
    expect(mocks.toastError).toHaveBeenCalledWith(messages.common.error);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.upsertProfile).not.toHaveBeenCalled();
    expect(audit).toMatchObject({ action: "user.name_changed", status: "failed.unknown" });
    expect(screen.getByRole("button", { name: messages.common.save })).toBeEnabled();
  });

  it("still reports a thrown name update as a failure", async () => {
    mocks.updateUser.mockRejectedValue(new Error("network"));

    const audit = await saveWithNewName();

    expect(mocks.toastError).toHaveBeenCalledWith(messages.common.error);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(audit.status).toBe("failed.unknown");
  });

  it("saves the name and preferences and audits success when the update succeeds", async () => {
    mocks.updateUser.mockResolvedValue({ data: { status: true }, error: null });

    const audit = await saveWithNewName();

    expect(mocks.upsertProfile).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(messages.dashboard.profile.saved);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(audit).toMatchObject({ action: "user.name_changed", status: "succeeded" });
  });
});
