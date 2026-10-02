import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import platform from "@web-app-starter/i18n/messages/en.json";
import app from "@repo/messages/en.json";

// A client-side navigation across [locale] mounts the layout in the browser, where next-themes
// creates its <script> and React logs "Encountered a script tag" (next-themes#387). Changing the
// locale must load a document instead.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/en/privacy/", useRouter: () => router }));
vi.mock("@web-app-starter/design-patterns", () => ({
  LanguageSelector: ({ onSelect }: { onSelect: (locale: string) => void }) => (
    <button type="button" onClick={() => onSelect("hu")}>pick hu</button>
  ),
}));

import { LocaleSwitcher } from "../../src/components/locale-switcher";

const assign = vi.fn();
const originalLocation = window.location;
beforeEach(() => {
  Object.defineProperty(window, "location", { value: { ...originalLocation, search: "?ref=nav", assign }, writable: true });
});
afterEach(() => {
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  vi.clearAllMocks();
});

test("changing the language loads the new locale's page, keeping the query string", () => {
  render(<NextIntlClientProvider locale="en" messages={{ ...platform, ...app }}><LocaleSwitcher /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "pick hu" }));
  expect(assign).toHaveBeenCalledWith("/hu/privacy/?ref=nav");
  expect(router.push).not.toHaveBeenCalled();
  expect(document.cookie).toContain("NEXT_LOCALE=hu");
});
