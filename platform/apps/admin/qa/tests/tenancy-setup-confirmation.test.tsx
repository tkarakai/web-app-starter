import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TenancySetup } from "../../src/components/tenancy/tenancy-setup";
const state = vi.hoisted(() => ({ configure: vi.fn().mockResolvedValue(undefined), status: {
  mode: null, running: null, eligibility: { complete: true, individualsAllowed: true, sharedStep: false, candidates: [], plans: { ready: true } },
} }));
vi.mock("convex/react", () => ({ useMutation: () => state.configure }));
vi.mock("../../src/components/tenancy/tenancy-required", () => ({ useTenancyStatus: () => state.status }));
it("requires explicit confirmation before applying the installation-wide choice", async () => {
  render(<TenancySetup />);
  const submit = screen.getByRole("button", { name: "Confirm and finish setup" });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(state.configure).toHaveBeenCalledWith({ mode: "organizations" }));
});
