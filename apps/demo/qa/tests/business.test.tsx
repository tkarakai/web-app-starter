import { expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Dashboard from "@/app/dashboard/page";
import { business, dispatchQueue, loads } from "@/business/dispatch";

test("app-owned priority rule and source data survive", () => {
  expect(business.name).toBe("Northstar Dispatch");
  expect(dispatchQueue([...loads].reverse()).map((load) => load.reference)).toEqual(["NS-104", "NS-105"]);
  expect(loads).toHaveLength(3);
});

test("actual dashboard dispatches ready freight without offering unready loads", () => {
  render(<Dashboard />);
  expect(screen.getByRole("heading", { name: "Northstar Dispatch" })).toBeTruthy();
  expect(screen.queryByText("Fresno cold storage")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dispatch NS-104" }));
  expect(screen.queryByRole("button", { name: "Dispatch NS-104" })).toBeNull();
  expect(screen.getByText("1 awaiting dispatch")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("1 dispatched this session");
});
