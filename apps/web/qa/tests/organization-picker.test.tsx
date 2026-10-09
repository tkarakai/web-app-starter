import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@repo/messages/en.json";
import { OrganizationPicker } from "../../src/components/organizations/organization-picker";
import { readOrganizationSelection } from "../../src/hooks/organization-selection";

const mocks = vi.hoisted(() => ({ contexts: [] as Array<{ organizationId: string; name: string; lifecycle: string }> }));
vi.mock("@/hooks/use-personal-data", () => ({ useOrganizationSnapshot: () => ({ userId: "user", mine: { contexts: mocks.contexts } }) }));
const a = { organizationId: "org-a", name: "First", lifecycle: "active" }; const b = { organizationId: "org-b", name: "Second", lifecycle: "active" };
const wrapper = (twice = false) => <NextIntlClientProvider locale="en" messages={messages}><OrganizationPicker />{twice && <OrganizationPicker />}</NextIntlClientProvider>;
beforeEach(() => { window.sessionStorage.clear(); window.history.replaceState({}, "", "/"); mocks.contexts = [a, b]; });
describe("tab-local context picker", () => {
  it("keeps a revoked selection unavailable until the user explicitly chooses their sole remaining membership", () => {
    const view = render(wrapper());
    expect(view.getByRole("combobox")).toHaveValue("");
    fireEvent.change(view.getByRole("combobox"), { target: { value: "org-b" } });
    expect(readOrganizationSelection("user")).toBe("org-b");
    mocks.contexts = [a]; view.rerender(wrapper());
    expect(view.getByRole("combobox")).toHaveValue("org-b");
    expect(view.getByRole("option", { name: messages.organizations.unavailable })).toBeDisabled();
    fireEvent.change(view.getByRole("combobox"), { target: { value: "org-a" } });
    expect(readOrganizationSelection("user")).toBe("org-a");
    expect(view.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("keeps initial personal UX unchanged and provides recovery from a foreign deep link", () => {
    mocks.contexts = [a]; const view = render(wrapper()); expect(view.queryByRole("combobox")).not.toBeInTheDocument();
    act(() => { window.history.replaceState({}, "", "/?organizationId=foreign"); window.dispatchEvent(new Event("popstate")); });
    expect(view.getByRole("combobox")).toHaveValue("foreign");
    expect(window.sessionStorage.getItem("organization-context:user")).toBe("foreign");
    expect(view.getByRole("option", { name: "First" })).toBeEnabled();
  });
  it("associates unique labels when sidebar and page both expose the selector", () => {
    const view = render(wrapper(true)); const pickers = view.getAllByLabelText(messages.organizations.context);
    expect(pickers).toHaveLength(2); expect(pickers[0]!.id).not.toBe(pickers[1]!.id);
  });
});
