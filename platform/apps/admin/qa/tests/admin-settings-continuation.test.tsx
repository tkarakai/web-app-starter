import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AdminSettingsClient } from "../../src/components/settings/admin-settings-client";

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.search }));
vi.mock("@/components/settings/admin-profile-section", () => ({ AdminProfileSection: () => <p>Profile content</p> }));
vi.mock("@/components/settings/admin-change-password-form", () => ({ AdminChangePasswordForm: () => <p>Password content</p> }));
vi.mock("@/components/settings/admin-passkey-section", () => ({ AdminPasskeySection: () => <p>Passkey content</p> }));
vi.mock("@/components/settings/admin-sessions-list", () => ({ AdminSessionsList: () => <p>Session content</p> }));
vi.mock("@/components/settings/admin-two-factor-section", () => ({
  AdminTwoFactorSection: () => <input aria-label="Unsaved setup" defaultValue="" />,
}));

beforeEach(() => { navigation.search = new URLSearchParams(); });

it.each(["", "tab=security"])("retains manual admin tabs and setup through suspension from %s", query => {
  navigation.search = new URLSearchParams(query);
  const view = (mode: "visible" | "hidden") => <React.Activity mode={mode}><AdminSettingsClient /></React.Activity>;
  const result = render(view("visible"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Security", exact: true }), { button: 0 });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Two-factor", exact: true }), { button: 0 });
  const setup = screen.getByLabelText("Unsaved setup");
  fireEvent.change(setup, { target: { value: "Keep the issued codes" } });

  result.rerender(view("hidden"));
  expect(setup).not.toBeVisible();
  result.rerender(view("visible"));
  expect(screen.getByRole("tab", { name: "Security", exact: true })).toHaveAttribute("data-state", "active");
  expect(screen.getByRole("tab", { name: "Two-factor", exact: true })).toHaveAttribute("data-state", "active");
  expect(screen.getByLabelText("Unsaved setup")).toBe(setup);
  expect(setup).toHaveValue("Keep the issued codes");

  // Actual navigation must still update the selection.
  navigation.search = new URLSearchParams("tab=profile");
  result.rerender(view("visible"));
  expect(screen.getByRole("tab", { name: "Profile", exact: true })).toHaveAttribute("data-state", "active");
  navigation.search = new URLSearchParams("tab=security");
  result.rerender(view("visible"));
  expect(screen.getByRole("tab", { name: "Password", exact: true })).toHaveAttribute("data-state", "active");
});
