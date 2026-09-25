import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import french from "@repo/i18n/messages/fr.json";
import { PasskeySection } from "@/components/settings/passkey-section";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  audit: vi.fn().mockResolvedValue(undefined),
  error: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => "optional",
  useMutation: () => mocks.audit,
}));
vi.mock("@repo/auth/client", () => ({
  authClient: {
    getSession: async () => ({ data: { user: { role: "user" } } }),
    passkey: { listUserPasskeys: mocks.list, addPasskey: mocks.add },
  },
}));
vi.mock("@repo/design-system", async (importOriginal) => ({
  ...await importOriginal<typeof import("@repo/design-system")>(),
  usePasskeySupport: () => ({ supported: true }),
  toast: { error: mocks.error, success: vi.fn() },
}));

describe("passkey localization", () => {
  beforeEach(() => {
    mocks.error.mockClear();
    mocks.list.mockResolvedValue({ data: [{ id: "key-1", name: null, deviceType: "multiDevice" }] });
    mocks.add.mockResolvedValue({ error: { message: "English provider error" } });
  });

  it("translates policy, device types, accessible actions and provider failures", async () => {
    render(<NextIntlClientProvider locale="fr" messages={french}><PasskeySection /></NextIntlClientProvider>);
    expect(await screen.findByText(french.dashboard.passkeys.unnamed)).toBeInTheDocument();
    expect(screen.getByText(french.dashboard.passkeys.multiDevice)).toBeInTheDocument();
    expect(screen.getByText(`Politique : ${french.dashboard.passkeys.optional}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: french.dashboard.passkeys.rename.replace("{name}", french.dashboard.passkeys.unnamed) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: french.dashboard.passkeys.add }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(french.dashboard.passkeys.addError));
    expect(mocks.error).not.toHaveBeenCalledWith("English provider error");
  });
});
