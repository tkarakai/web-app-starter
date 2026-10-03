import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { AdminOnboardingWizard } from "@/components/onboarding/admin-onboarding-wizard";

const mocks = vi.hoisted(() => ({
  advance: vi.fn(),
  status: { completed: false, step: 1 },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: {
  getSession: vi.fn(async () => ({ data: { session: { id: "fresh-session" }, user: { email: "owner@example.test" } } })),
} }));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref).endsWith(":advanceOnboardingStep") ? mocks.advance : vi.fn(async () => null),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref).endsWith(":getMyOnboardingStatus") ? mocks.status : undefined,
}));
vi.mock("@/components/onboarding/steps/totp-setup-step", () => ({
  TotpSetupStep: ({ onComplete }: { onComplete: (codes: string[]) => Promise<void> }) =>
    <button onClick={() => { void onComplete([]).catch(() => {}); }}>Finish TOTP</button>,
}));
vi.mock("@/components/onboarding/steps/backup-codes-step", () => ({
  BackupCodesStep: () => <div>Backup password prompt</div>,
}));

beforeEach(() => {
  mocks.advance.mockReset();
  mocks.status = { completed: false, step: 1 };
});

test("session rotation retries progress persistence before showing backup codes and resumes at step 2", async () => {
  let persist!: () => void;
  mocks.advance.mockRejectedValueOnce(new ConvexError("NOT_AUTHENTICATED"))
    .mockImplementationOnce(() => new Promise<void>(resolve => { persist = resolve; }));
  const view = render(<AdminOnboardingWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Finish TOTP" }));
  await waitFor(() => expect(mocks.advance).toHaveBeenCalledTimes(2));
  expect(mocks.advance).toHaveBeenLastCalledWith({ step: 2 });
  expect(screen.queryByText("Backup password prompt")).not.toBeInTheDocument();
  mocks.status = { completed: false, step: 2 };
  persist();
  await screen.findByText("Backup password prompt");
  view.unmount();
  render(<AdminOnboardingWizard />);
  await screen.findByText("Backup password prompt");
  expect(screen.queryByRole("button", { name: "Finish TOTP" })).not.toBeInTheDocument();
});

test("a persistence failure keeps the wizard at TOTP for a user retry", async () => {
  mocks.advance.mockRejectedValueOnce(new Error("INVALID_ENROLLMENT"));
  render(<AdminOnboardingWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Finish TOTP" }));
  await waitFor(() => expect(mocks.advance).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Backup password prompt")).not.toBeInTheDocument();
  mocks.advance.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "Finish TOTP" }));
  await screen.findByText("Backup password prompt");
});
