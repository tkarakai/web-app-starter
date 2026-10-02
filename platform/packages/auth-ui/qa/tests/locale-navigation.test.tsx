import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import platform from "@web-app-starter/i18n/messages/en.json";

// A client-side navigation across [locale] mounts the layout in the browser, where next-themes
// creates its <script> and React logs "Encountered a script tag" (next-themes#387). Crossing
// locales must load a document; staying in one locale keeps the router.
const mocks = vi.hoisted(() => ({
  profileLocale: vi.fn(),
  setLocale: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("../../src/actions", () => ({ getAuthUserLocaleAction: mocks.profileLocale }));
vi.mock("next/navigation", () => ({ usePathname: () => "/en/sign-in", useRouter: () => mocks.router }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.setLocale }));
vi.mock("@repo/backend", () => ({ api: { platform: { userProfiles: { setLocale: "setLocale" } } } }));
vi.mock("../../src/components/auth-guard", () => ({ useAuthUser: () => null }));
vi.mock("@web-app-starter/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@web-app-starter/design-system")>()),
  useNetworkStatus: () => true,
}));
vi.mock("@web-app-starter/design-patterns", () => ({
  LanguageSelector: ({ onSelect }: { onSelect: (locale: string) => void }) => (
    <button type="button" onClick={() => onSelect("de")}>pick de</button>
  ),
}));

import { LocaleSwitcher } from "../../src/components/locale-switcher";
import { redirectWithUserLocale } from "../../src/lib/auth-locale";

const assign = vi.fn();
const originalLocation = window.location;
const router = mocks.router as unknown as Parameters<typeof redirectWithUserLocale>[0];

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, pathname: "/en/sign-in", search: "?invite=abc", assign },
    writable: true,
  });
});
afterEach(() => {
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  vi.clearAllMocks();
});

describe("locale changes load a document", () => {
  it("the language switcher loads the new locale's page, keeping the query string", () => {
    render(<NextIntlClientProvider locale="en" messages={platform}><LocaleSwitcher /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "pick de" }));
    expect(assign).toHaveBeenCalledWith("/de/sign-in?invite=abc");
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("sign-in lands on the profile locale's dashboard with a full load when it differs from the URL", async () => {
    mocks.profileLocale.mockResolvedValue("hu");
    await redirectWithUserLocale(router);
    expect(assign).toHaveBeenCalledWith("/hu/dashboard");
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("sign-in keeps the router when the locale does not change", async () => {
    mocks.profileLocale.mockResolvedValue(null);
    await redirectWithUserLocale(router);
    expect(mocks.router.push).toHaveBeenCalledWith("/en/dashboard");
    expect(assign).not.toHaveBeenCalled();
    mocks.router.push.mockClear();

    mocks.profileLocale.mockResolvedValue("en");
    await redirectWithUserLocale(router);
    expect(mocks.router.push).toHaveBeenCalledWith("/en/dashboard");
    expect(assign).not.toHaveBeenCalled();
  });

  it("a failed profile lookup falls back to the current locale through the router", async () => {
    mocks.profileLocale.mockRejectedValue(new Error("offline"));
    await redirectWithUserLocale(router);
    expect(mocks.router.push).toHaveBeenCalledWith("/en/dashboard");
    expect(assign).not.toHaveBeenCalled();
  });
});
