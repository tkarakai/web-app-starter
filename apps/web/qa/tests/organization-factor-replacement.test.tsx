import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { getFunctionName } from "convex/server";
import messages from "@web-app-starter/i18n/messages/en.json";
import { OrganizationFactorReplacement } from "../../../../platform/packages/auth-ui/src/settings/organization-factor-replacement";

const mocks = vi.hoisted(() => ({ identity: "user-a", begin: vi.fn(), complete: vi.fn() }));
vi.mock("convex/react", () => ({ useAction: (reference: Parameters<typeof getFunctionName>[0]) => getFunctionName(reference).endsWith(":begin") ? mocks.begin : mocks.complete }));
vi.mock("@web-app-starter/auth/client", () => ({ authClient: { useSession: () => ({ data: { user: { id: mocks.identity } } }) } }));
const t = messages.accountSecurity;
const staged = { changeId: "change-a", totpURI: "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP", backupCodes: ["first-code", "second-code"] };
const wrapper = () => <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><OrganizationFactorReplacement /></NextIntlClientProvider>;
function begin(view: ReturnType<typeof render>) { const input = view.getByLabelText(t.changePassword.currentPassword); fireEvent.change(input, { target: { value: "password-proof" } }); fireEvent.submit(input.closest("form")!); }
beforeEach(() => { vi.clearAllMocks(); mocks.identity = "user-a"; mocks.begin.mockResolvedValue(staged); mocks.complete.mockResolvedValue(undefined); });
describe("staged factor replacement ceremony", () => {
  it("requires a live password, staged TOTP and two distinct saved codes before completing", async () => {
    const view = render(wrapper()); begin(view);
    await waitFor(() => expect(view.getByText(t.twoFactor.scanQrCode)).toBeInTheDocument());
    expect(mocks.begin).toHaveBeenCalledWith({ password: "password-proof" });
    expect(view.container.querySelector("[data-agent-sensitive]")).not.toBeNull();
    fireEvent.change(view.getByLabelText(t.twoFactor.enterCode), { target: { value: "123456" } });
    fireEvent.change(view.getByLabelText(`${t.twoFactor.backupCodes} (1)`), { target: { value: "first-code" } });
    fireEvent.change(view.getByLabelText(`${t.twoFactor.backupCodes} (2)`), { target: { value: "first-code" } });
    expect(view.getByRole("button", { name: t.session.verify })).toBeDisabled();
    expect(mocks.complete).not.toHaveBeenCalled();
    fireEvent.change(view.getByLabelText(`${t.twoFactor.backupCodes} (2)`), { target: { value: "second-code" } });
    fireEvent.click(view.getByRole("button", { name: t.session.verify }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({ changeId: "change-a", code: "123456", backupCodes: ["first-code", "second-code"] }));
    await waitFor(() => expect(view.getByRole("status")).toHaveTextContent(t.twoFactor.enabled));
    expect(view.container.textContent).not.toContain(staged.backupCodes[0]);
  });
  it("retains a safe retry on rejected proof without pretending that the old factor was replaced", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("INVALID_TOTP"));
    const view = render(wrapper()); begin(view);
    await waitFor(() => expect(view.getByText(t.twoFactor.scanQrCode)).toBeInTheDocument());
    fireEvent.change(view.getByLabelText(t.twoFactor.enterCode), { target: { value: "000000" } });
    fireEvent.change(view.getByLabelText(`${t.twoFactor.backupCodes} (1)`), { target: { value: "first-code" } });
    fireEvent.change(view.getByLabelText(`${t.twoFactor.backupCodes} (2)`), { target: { value: "second-code" } });
    fireEvent.click(view.getByRole("button", { name: t.session.verify }));
    await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent(t.session.failed));
    expect(view.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: messages.common.cancel }));
    expect(view.getByLabelText(t.changePassword.currentPassword)).toHaveValue("");
    expect(view.container.textContent).not.toContain(staged.backupCodes[0]);
  });
  it("preserves issued codes across Activity suspension without exposing them while hidden", async () => {
    const view = render(<Activity mode="visible">{wrapper()}</Activity>); begin(view);
    await waitFor(() => expect(view.getByText(t.twoFactor.scanQrCode)).toBeInTheDocument());
    const codes = view.container.querySelector("[data-slot=copyable-field] pre")!;
    expect(codes.textContent).toBe(staged.backupCodes.join("\n"));
    view.rerender(<Activity mode="hidden">{wrapper()}</Activity>);
    expect(codes).not.toBeVisible();
    view.rerender(<Activity mode="visible">{wrapper()}</Activity>);
    expect(codes).toBeVisible();
    expect(mocks.begin).toHaveBeenCalledOnce();
  });
  it("discards delayed setup secrets on account change and permits the new identity to start afresh", async () => {
    let resolve!: (value: typeof staged) => void;
    mocks.begin.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(wrapper()); begin(view);
    mocks.identity = "user-b"; view.rerender(wrapper());
    await act(async () => resolve(staged));
    expect(view.container.textContent).not.toContain(staged.backupCodes[0]);
    expect(view.queryByText(t.twoFactor.scanQrCode)).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: t.session.continue })).not.toBeDisabled();
    expect(view.getByLabelText(t.changePassword.currentPassword)).toHaveValue("");
  });
});
