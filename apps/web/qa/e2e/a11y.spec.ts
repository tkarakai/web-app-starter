import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn } from "./helpers/auth";

/** One line per violation, naming the nodes, so a failure says what to fix. */
async function axeViolations(page: import("@playwright/test").Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => `${node.target.join(" ")} ${node.html.slice(0, 160)}`).join(" | ")}`);
}

test.describe("Accessibility", () => {
  test("sign-in form fields have proper labels", async ({ page }) => {
    await page.goto("/sign-in");
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withRules(["label", "label-title-only", "autocomplete-valid"])
      .analyze();

    expect(results.violations).toHaveLength(0);
  });

  // axe's full default rule set (WCAG A/AA and best practices) on the platform markup every app
  // ships: sign-in, and the signed-in shell with the development environment banner (#416).
  for (const colorScheme of ["light", "dark"] as const) {
    test(`sign-in page has no axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/en/sign-in");
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page)).toEqual([]);
    });

    test(`signed-in dashboard shell has no axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await signIn(page);
      await page.goto("/en/dashboard");
      await page.waitForLoadState("networkidle");
      // Audit the settled shell: organization data loaded and the overview titled (its h1).
      await expect(page.getByTestId("active-organization")).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("homepage is keyboard navigable", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const body = page.locator("body");
    await body.press("Tab");

    const focusedElement = page.locator(":focus");
    await expect(focusedElement).toBeVisible();

    await page.keyboard.press("Tab");
    const secondFocusedElement = page.locator(":focus");
    await expect(secondFocusedElement).toBeVisible();
  });
});
