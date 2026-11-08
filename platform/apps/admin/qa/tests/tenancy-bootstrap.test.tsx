import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TenancyRequired } from "../../src/components/tenancy/tenancy-required";

const state = vi.hoisted(() => ({ status: undefined as unknown, path: "/manage/users" }));
vi.mock("convex/react", () => ({ useQuery: () => state.status }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@web-app-starter/auth-ui", () => ({ useSignOut: () => vi.fn() }));
vi.mock("../../src/components/tenancy/tenancy-setup", () => ({ TenancySetup: () => <input aria-label="Setup draft" /> }));
beforeEach(() => { state.status = undefined; state.path = "/manage/users"; });

it("blocks normal content while loading, traps setup, and preserves its draft across navigation", () => {
  const view = () => <TenancyRequired><p>Normal admin content</p></TenancyRequired>;
  const result = render(view());
  expect(screen.queryByText("Normal admin content")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Checking your installation");
  state.status = { mode: null, running: null, eligibility: { plans: { ready: true } } };
  result.rerender(view());
  const draft = screen.getByLabelText("Setup draft");
  fireEvent.change(draft, { target: { value: "Keep this" } });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  state.path = "/configure/tenancy";
  result.rerender(view());
  expect(screen.getByLabelText("Setup draft")).toHaveValue("Keep this");
  state.status = { mode: "individuals", running: null, eligibility: null };
  result.rerender(view());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Normal admin content")).toBeVisible();
});

it("allows security and plan repair without dismissing bootstrap for normal pages", () => {
  state.status = { mode: null, running: null, eligibility: { plans: { ready: false } } };
  state.path = "/settings";
  const result = render(<TenancyRequired><p>Security settings</p></TenancyRequired>);
  expect(screen.getByText("Security settings")).toBeVisible();
  expect(screen.getByRole("link", { name: "Back to setup" })).toBeVisible();
  state.path = "/manage/plans";
  result.rerender(<TenancyRequired><p>Plan repair</p></TenancyRequired>);
  expect(screen.getByText("Plan repair")).toBeVisible();
});

 it("keeps one-time security state mounted through session-token rotation", () => {
  state.status = { mode: "individuals", running: null, eligibility: null };
  state.path = "/settings";
  const view = () => <TenancyRequired><input aria-label="Issued backup codes" defaultValue="once-only" /></TenancyRequired>;
  const result = render(view());
  const codes = screen.getByLabelText("Issued backup codes");
  for (const status of [undefined, null, { mode: "individuals", running: null, eligibility: null }]) {
    state.status = status;
    result.rerender(view());
    expect(screen.getByLabelText("Issued backup codes")).toBe(codes);
    expect(codes).toHaveValue("once-only");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  }
});

it("waits for tenancy before mounting security pages in their final shell", () => {
  state.path = "/settings";
  const result = render(<TenancyRequired><input aria-label="Security form" /></TenancyRequired>);
  expect(screen.queryByLabelText("Security form")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeVisible();
  state.status = { mode: "organizations", running: null, eligibility: null };
  result.rerender(<TenancyRequired><input aria-label="Security form" /></TenancyRequired>);
  expect(screen.getByLabelText("Security form")).toBeVisible();
});
