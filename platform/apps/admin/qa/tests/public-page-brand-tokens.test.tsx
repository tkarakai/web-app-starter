/**
 * The admin's public pages (sign-in, forgot and reset password, onboarding) can carry token
 * overrides of their own: `brand.tokenOverrides["admin-public"]` is rendered by their layouts,
 * after the root layout's admin tokens, and never for the dashboard.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import rawAppConfig from "../../../../../app.config";
import { validateAppConfig, type AppConfig } from "@web-app-starter/app-config";
import { PublicPageBrandTokens } from "@/components/auth/public-page-brand-tokens";

function configWith(tokenOverrides: AppConfig["brand"]["tokenOverrides"]): AppConfig {
  const draft = JSON.parse(JSON.stringify(rawAppConfig)) as AppConfig;
  draft.brand.tokenOverrides = tokenOverrides;
  return validateAppConfig(draft);
}

function styles(config: AppConfig): string[] {
  const { container } = render(<PublicPageBrandTokens config={config} />);
  return Array.from(container.querySelectorAll("style[data-brand-tokens]")).map((style) => style.textContent ?? "");
}

describe("PublicPageBrandTokens", () => {
  it("renders the admin-public tokens as a :root rule", () => {
    expect(styles(configWith({ "admin-public": { "--primary": "#123456" } }))).toEqual([":root{--primary:#123456}"]);
  });

  it("repeats nothing from the admin's own or the shared tokens", () => {
    const config = configWith({
      "*": { "--radius": "0.25rem" },
      admin: { "--primary": "#111111" },
      "admin-public": { "--primary": "#123456", "--accent": "#abcdef" },
    });
    expect(styles(config)).toEqual([":root{--primary:#123456;--accent:#abcdef}"]);
  });

  it("renders nothing without admin-public tokens: the flat form, no overrides, or other scopes only", () => {
    expect(styles(configWith({}))).toEqual([]);
    expect(styles(configWith({ "--primary": "#123456" }))).toEqual([]);
    expect(styles(configWith({ "*": { "--radius": "0.25rem" }, admin: { "--primary": "#111111" } }))).toEqual([]);
  });
});
