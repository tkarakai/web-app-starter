import { expect, test, type Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * The Components sidebar group. Scoped to avoid matching the Foundations
 * group which also has a "Layout" category.
 */
function componentsGroup(page: Page) {
  return page
    .locator('[data-sidebar="group"]')
    .filter({
      has: page.locator('[data-sidebar="group-label"]', {
        hasText: "Components",
      }),
    });
}

/**
 * Return a single category button by its visible label.
 * Scoped to the Components sidebar group.
 */
function categoryButton(page: Page, label: string) {
  return componentsGroup(page)
    .locator('[data-sidebar="menu-button"]')
    .filter({ hasText: label });
}

/** Return the collapsible wrapper (ancestor <li>) for a category. */
function categoryCollapsible(page: Page, label: string) {
  return categoryButton(page, label).locator(
    "xpath=ancestor::li[@data-sidebar='menu-item']",
  );
}

/** Whether a category's sub-menu is currently visible (expanded). */
async function isCategoryExpanded(
  page: Page,
  label: string,
): Promise<boolean> {
  const collapsible = categoryCollapsible(page, label);
  const state = await collapsible.getAttribute("data-state");
  return state === "open";
}

/** Return all visible sub-item links inside a category. */
function subItemLinks(page: Page, category: string) {
  return categoryCollapsible(page, category).locator(
    '[data-sidebar="menu-sub-button"]',
  );
}

/** Click a category to toggle it open/closed. */
async function toggleCategory(page: Page, label: string) {
  await categoryButton(page, label).click();
}

// ── Constants ────────────────────────────────────────────────────────

const CATEGORIES = [
  "Actions",
  "Data Display",
  "Feedback",
  "Form",
  "Layout",
  "Overlay",
] as const;

// ── Tests ────────────────────────────────────────────────────────────

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/components/button");
    await expect(categoryButton(page, "Actions")).toBeVisible();
  });

  // ── 1. No hardcoded default-open categories ─────────────────────

  test("no category is hardcoded to be expanded by default", async ({
    page,
  }) => {
    // Navigate to the dashboard (not a component/category route)
    // so no auto-expand should trigger
    await page.goto("/dashboard");
    await expect(categoryButton(page, "Actions")).toBeVisible();

    for (const cat of CATEGORIES) {
      expect(
        await isCategoryExpanded(page, cat),
        `"${cat}" should be collapsed`,
      ).toBe(false);
    }
  });

  // ── 2. Expand/collapse state persists during navigation ─────────

  test("sidebar categories hold their expand/collapse state when navigating between components", async ({
    page,
  }) => {
    // "Actions" is auto-expanded (because we're on /components/button)
    expect(await isCategoryExpanded(page, "Actions")).toBe(true);

    // Manually expand "Feedback"
    await toggleCategory(page, "Feedback");
    expect(await isCategoryExpanded(page, "Feedback")).toBe(true);

    // Click a component in "Feedback"
    await subItemLinks(page, "Feedback")
      .filter({ hasText: "Alert" })
      .click();
    await expect(page).toHaveURL(/\/components\/alert$/);

    // Both should still be expanded
    expect(await isCategoryExpanded(page, "Actions")).toBe(true);
    expect(await isCategoryExpanded(page, "Feedback")).toBe(true);

    // Click a component in "Actions"
    await subItemLinks(page, "Actions")
      .filter({ hasText: "Toggle" })
      .click();
    await expect(page).toHaveURL(/\/components\/toggle$/);

    // Both should still be expanded
    expect(await isCategoryExpanded(page, "Actions")).toBe(true);
    expect(await isCategoryExpanded(page, "Feedback")).toBe(true);
  });

  // ── 3. Category click shows cards page ──────────────────────────

  test("clicking a category navigates to the category cards page", async ({
    page,
  }) => {
    await toggleCategory(page, "Form");
    await expect(page).toHaveURL(/\/components\/category\/form$/);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Form");

    // Should show 6 component cards (Checkbox, Input, Radio Group, Select, Switch, Textarea)
    const cards = page.locator("a.group");
    await expect(cards).toHaveCount(6);
  });

  test("category cards page shows component names and descriptions", async ({
    page,
  }) => {
    await page.goto("/components/category/actions");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Actions",
    );

    const buttonCard = page
      .locator("a.group")
      .filter({ has: page.getByRole("heading", { name: "Button", exact: true }) });
    await expect(buttonCard).toBeVisible();
    await expect(buttonCard).toContainText(
      "Trigger actions and events with multiple variants.",
    );
  });

  // ── 4. Cards are clickable and navigate to component pages ──────

  test("clicking a card on the category page opens the component showcase", async ({
    page,
  }) => {
    await page.goto("/components/category/data-display");

    await page.locator("a.group").filter({ hasText: "Badge" }).click();
    await expect(page).toHaveURL(/\/components\/badge$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Badge");
  });

  // ── 5 & 6. Breadcrumb links ─────────────────────────────────────

  test("breadcrumb shows category link on a component page", async ({
    page,
  }) => {
    await page.goto("/components/input");

    const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
    await expect(breadcrumb.getByText("Form")).toBeVisible();
    await expect(breadcrumb.getByText("Input")).toBeVisible();
  });

  test("clicking category in breadcrumb navigates to category page", async ({
    page,
  }) => {
    await page.goto("/components/input");

    // Category breadcrumb is a dropdown trigger (button), not a plain link
    const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
    await breadcrumb.getByRole("button", { name: /Form/ }).click();
    await page.getByRole("menuitem", { name: "Form", exact: true }).click();
    await expect(page).toHaveURL(/\/components\/category\/form$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Form");
  });

  // ── 7. Breadcrumb navigation preserves sidebar state ────────────

  test("clicking category breadcrumb link does not collapse other sidebar categories", async ({
    page,
  }) => {
    // On /components/button — "Actions" is auto-expanded
    expect(await isCategoryExpanded(page, "Actions")).toBe(true);

    // Manually expand "Overlay"
    await toggleCategory(page, "Overlay");
    expect(await isCategoryExpanded(page, "Overlay")).toBe(true);

    // Click the "Actions" breadcrumb dropdown, then the Actions menuitem
    const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
    await breadcrumb.getByRole("button", { name: /Actions/ }).click();
    await page.getByRole("menuitem", { name: "Actions", exact: true }).click();
    await expect(page).toHaveURL(/\/components\/category\/actions$/);

    // "Overlay" should still be expanded
    expect(await isCategoryExpanded(page, "Overlay")).toBe(true);
  });

  // ── 8. Category highlighting ────────────────────────────────────

  test("category is highlighted in sidebar when on its category page", async ({
    page,
  }) => {
    await page.goto("/components/category/feedback");

    await expect(categoryButton(page, "Feedback")).toHaveAttribute(
      "data-active",
      "true",
    );

    // Other categories should not be active
    await expect(categoryButton(page, "Actions")).not.toHaveAttribute(
      "data-active",
      "true",
    );
  });

  // ── 9. Category + component highlighting ────────────────────────

  test("both category and component are highlighted when on a component page", async ({
    page,
  }) => {
    await page.goto("/components/select");

    // "Form" category button should be active
    await expect(categoryButton(page, "Form")).toHaveAttribute(
      "data-active",
      "true",
    );

    // "Select" sub-item should be active
    const selectItem = subItemLinks(page, "Form").filter({
      hasText: "Select",
    });
    await expect(selectItem).toHaveAttribute("data-active", "true");

    // Other sub-items should not be active
    const inputItem = subItemLinks(page, "Form").filter({ hasText: "Input" });
    await expect(inputItem).not.toHaveAttribute("data-active", "true");
  });

  // ── 10. Auto-expand when selecting from cards page ──────────────

  test("category auto-expands when navigating to a component whose category was collapsed", async ({
    page,
  }) => {
    // Go to "Overlay" category page — Overlay auto-expands
    await page.goto("/components/category/overlay");
    expect(await isCategoryExpanded(page, "Overlay")).toBe(true);

    // "Layout" should be collapsed
    expect(await isCategoryExpanded(page, "Layout")).toBe(false);

    // Navigate to a Layout component via card click
    await page.goto("/components/tabs");

    // "Layout" should now be auto-expanded
    expect(await isCategoryExpanded(page, "Layout")).toBe(true);
  });

  test("clicking a card on the category page auto-expands the target category in sidebar", async ({
    page,
  }) => {
    await page.goto("/components/category/form");

    // Click a card to navigate to the component page
    await page.locator("a.group").filter({ hasText: "Checkbox" }).click();
    await expect(page).toHaveURL(/\/components\/checkbox$/);

    // "Form" should be expanded and active
    expect(await isCategoryExpanded(page, "Form")).toBe(true);
    await expect(categoryButton(page, "Form")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  // ── 11. Breadcrumb shows category name on category page ─────────

  test("breadcrumb shows category name as current page on category pages", async ({
    page,
  }) => {
    await page.goto("/components/category/layout");

    const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
    await expect(breadcrumb.getByText("Layout")).toBeVisible();
  });
});
