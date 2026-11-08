import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RecentLoginPolicyCard } from "../../src/components/settings/recent-login-policy-card";

const mocks = vi.hoisted(() => ({ minutes: 60, save: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.minutes, useMutation: () => mocks.save }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => { mocks.minutes = 60; mocks.save.mockReset().mockResolvedValue(null); });

it("loads the current policy and saves minutes", async () => {
  render(<RecentLoginPolicyCard />);
  const input = screen.getByLabelText("Verification interval (minutes)");
  expect(input).toHaveValue(60);
  fireEvent.change(input, { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ key: "adminRecentLoginMinutes", value: "90" }));
});

it.each(["0", "241", "1.5", ""])("prevents invalid intervals (%s)", value => {
  render(<RecentLoginPolicyCard />);
  fireEvent.change(screen.getByLabelText("Verification interval (minutes)"), { target: { value } });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
});
