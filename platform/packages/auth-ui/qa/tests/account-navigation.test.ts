import { describe, expect, test } from "bun:test";
import { accountPageHref, accountReturnPath } from "../../src/lib/account-navigation";

describe("account return navigation", () => {
  test("keeps a workspace route, its selection and anchor, without binding it to the old locale", () => {
    expect(accountReturnPath("/en/dashboard?project=p1&tab=attachments#files"))
      .toBe("/dashboard?project=p1&tab=attachments#files");
    expect(accountReturnPath("/hu/dashboard/reports?range=week")).toBe("/dashboard/reports?range=week");
  });

  test.each([
    null, "", "https://evil.example/dashboard", "//evil.example/dashboard", "javascript:alert(1)",
    "/\\evil.example/dashboard", "/sign-in", "/dashboardish", "/dashboard/../sign-in", "/dashboard/%",
    "/dashboard/settings", "/en/dashboard/settings?tab=security", "/dashboard/settings/sessions",
    "/dashboard/organization", "/dashboard/%73ettings", "/dashboard/settings%2fsessions",
    "/dashboard/%2e%2e%2fsettings", "/dashboard/reports%2f..%2fsettings",
  ])("uses app home instead of an unsafe or looping return target: %s", candidate => {
    expect(accountReturnPath(candidate)).toBe("/dashboard");
  });

  test("opening an account screen records the app page", () => {
    const href = accountPageHref("settings", "/en/dashboard", "project=p1&tab=attachments");
    const url = new URL(href, "https://app.example");
    expect(url.pathname).toBe("/dashboard/settings");
    expect(url.searchParams.get("returnTo")).toBe("/dashboard?project=p1&tab=attachments");
  });

  test("switching account screens, their tabs or nested routes retains the original app page", () => {
    const search = new URLSearchParams({ returnTo: "/dashboard?project=p1&tab=attachments", tab: "security" });
    for (const pathname of ["/en/dashboard/settings", "/en/dashboard/settings/sessions", "/en/dashboard/organization"]) {
      const url = new URL(accountPageHref("organization", pathname, search.toString()), "https://app.example");
      expect(url.searchParams.get("returnTo")).toBe("/dashboard?project=p1&tab=attachments");
    }
  });

  test("a direct account link has an app-home fallback", () => {
    expect(new URL(accountPageHref("settings", "/en/dashboard/organization", ""), "https://app.example")
      .searchParams.get("returnTo")).toBe("/dashboard");
  });
});
