/** Accessibility of platform-owned markup every app ships (#416). */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EnvironmentBanner, Sidebar, SidebarProvider } from "@web-app-starter/design-system";
import { LanguageSelector } from "@web-app-starter/design-patterns";

describe("platform markup accessibility", () => {
  it("names the language selector by its visible language first, then its label (WCAG 2.5.3 Label in Name)", () => {
    const locales = [{ code: "en", nativeName: "English", flag: "🇬🇧" }, { code: "de", nativeName: "Deutsch", flag: "🇩🇪" }];
    render(<LanguageSelector currentLocale="en" locales={locales} onSelect={() => {}} ariaLabel="Select language" />);
    const trigger = screen.getByRole("button", { name: /Select language/ });
    expect(trigger).not.toHaveAttribute("aria-label");
    expect(trigger).toHaveAccessibleName("🇬🇧 English Select language");
  });

  it("renders environment banner text at full foreground contrast, without opacity utilities", () => {
    // Text at 70% opacity on the environment band measured 3.9:1 (development) and 3.1:1 (staging).
    for (const environment of ["development", "staging"] as const) {
      const { container, unmount } = render(<EnvironmentBanner environment={environment} appName="web" platformVersion="5.0.3" gitBranch="main" gitSha="abc1234" />);
      const faded = [...container.querySelectorAll("[class*='opacity-']")].filter(element => element.textContent?.trim() && !element.getAttribute("aria-hidden"));
      expect(faded.map(element => element.outerHTML)).toEqual([]);
      unmount();
    }
  });

  it("exposes the desktop sidebar as a navigation landmark named by its label", () => {
    render(<SidebarProvider><Sidebar labels={{ title: "Navigation", description: "Navigation", close: "Close" }}><a href="/x">Item</a></Sidebar></SidebarProvider>);
    expect(screen.getByRole("navigation", { name: "Navigation" })).toContainElement(screen.getByRole("link", { name: "Item" }));
  });
});
