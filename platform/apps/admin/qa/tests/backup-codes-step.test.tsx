import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { BackupCodesStep } from "@/components/onboarding/steps/backup-codes-step";

const fetchCodes = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useAction: () => fetchCodes }));
beforeEach(() => { fetchCodes.mockReset(); });

test("resuming enrollment waits for explicit password proof and permits retry", async () => {
  fetchCodes.mockRejectedValueOnce(new Error("REAUTHENTICATION_REQUIRED"))
    .mockResolvedValueOnce(["first-code", "second-code"]);
  render(<BackupCodesStep backupCodes={[]} onComplete={vi.fn()} />);
  expect(fetchCodes).not.toHaveBeenCalled();
  expect(screen.queryByText("first-code")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "View backup codes" }));
  await screen.findByRole("alert");
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current password" } });
  fireEvent.click(screen.getByRole("button", { name: "View backup codes" }));
  await waitFor(() => expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument());
  expect(fetchCodes).toHaveBeenLastCalledWith({ password: "current password" });
  expect(screen.getByText(/first-code/)).toBeInTheDocument();
});

test("uninterrupted enrollment retains the freshly generated codes without refetching", () => {
  render(<BackupCodesStep backupCodes={["first-code", "second-code"]} onComplete={vi.fn()} />);
  expect(fetchCodes).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  expect(screen.getByText(/first-code/)).toBeInTheDocument();
});
