import { expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { clampSidebarWidth, snapSidebarWidth } from "@repo/starter-sidebar-policy";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

function ResizeProbe() {
  const { sidebarWidth, setSidebarWidth } = useSidebar();
  return <button onClick={() => setSidebarWidth(Number.NaN)}>Width {sidebarWidth}</button>;
}

test("finite sizing and snapping remain compatible", () => {
  expect(clampSidebarWidth(2)).toBe(10);
  expect(clampSidebarWidth(30)).toBe(24);
  expect(snapSidebarWidth(13.6)).toBe(14);
  expect(snapSidebarWidth(13.123)).toBe(13.12);
});

test("non-finite policy inputs use the default (sidebar-finite-width action)", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    expect(clampSidebarWidth(invalid)).toBe(16);
    expect(snapSidebarWidth(invalid)).toBe(16);
  }
});

test("consuming sidebar cannot poison state or CSS (sidebar-finite-width action)", () => {
  document.cookie = "sidebar_width=16";
  const { container } = render(<SidebarProvider><ResizeProbe /></SidebarProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Width 16" }));
  expect(screen.getByRole("button").textContent).toBe("Width 16");
  expect(container.firstElementChild?.getAttribute("style")).toContain("--sidebar-width: 16rem");
  expect(document.cookie).toContain("sidebar_width=16");
  expect(document.cookie).not.toContain("NaN");
});
