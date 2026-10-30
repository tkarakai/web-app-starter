/* global DOMRectList */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { browserActions } from "@web-app-starter/agentic/browser-actions";

// happy-dom has no layout. Model only visibility; use production traversal,
// accessible-name extraction, opaque control registry and action dispatch.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden], [style*="display: none"]') ? [] : [{}]) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, "checkVisibility").mockImplementation(function (this: HTMLElement) {
    return !this.closest('[hidden], [style*="display: none"]');
  });
});
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

const snapshot = async () => browserActions(document, vi.fn())("browser_readPage", { offset: 0, controlsOffset: 0 });

test("agent row summaries exclude sensitive descendants of otherwise public controls", async () => {
  document.body.innerHTML = '<table><tbody><tr><td>Public organization</td><td data-agent-sensitive>PRIVATE_MEMBER_SECRET</td><td><button>Open organization</button></td></tr></tbody></table>';
  const result = await snapshot();
  expect(JSON.stringify(result)).toContain("Public organization");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_MEMBER_SECRET");
});

test.each(["hidden", 'aria-hidden="true"', "data-agent-sensitive", 'style="display: none"'])("accessible labels exclude %s referenced text", async hidden => {
  document.body.innerHTML = `<span id="public-label">Organization</span><span id="private-label" ${hidden}>PRIVATE_LABEL_SECRET</span><button aria-labelledby="public-label private-label">Open</button>`;
  const result = await snapshot();
  expect(JSON.stringify(result)).toContain("Organization");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_LABEL_SECRET");
});

test("associated labels and button descendants cannot recover protected nested text", async () => {
  document.body.innerHTML = '<label for="name">Public name<span data-agent-sensitive>PRIVATE_ASSOCIATED_SECRET</span></label><input id="name"><button>Open<span data-agent-sensitive>PRIVATE_BUTTON_SECRET</span></button>';
  const result = JSON.stringify(await snapshot());
  expect(result).toContain("Public name");
  expect(result).not.toContain("PRIVATE_ASSOCIATED_SECRET");
  expect(result).not.toContain("PRIVATE_BUTTON_SECRET");
});

test("credential modal portals, hidden trees and secret inputs stay outside page results", async () => {
  document.body.innerHTML = '<main hidden><button>PRIVATE_HIDDEN_TREE</button></main><input type="password" value="PRIVATE_PASSWORD"><div role="dialog" data-agent-sensitive><p>PRIVATE_RECOVERY_CODES</p><button>Continue</button></div>';
  const result = await snapshot();
  expect(result).toMatchObject({ status: "requires_user_action", executed: false });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
});

test("captured controls fail after removal, hiding or becoming sensitive", async () => {
  document.body.innerHTML = '<button id="target">Open organization</button>';
  const clicked = vi.fn(); const element = document.querySelector<HTMLButtonElement>("#target")!;
  element.addEventListener("click", clicked);
  const execute = browserActions(document, vi.fn());
  const result = await execute("browser_readPage", { offset: 0, controlsOffset: 0 }) as { controls: { controlId: string }[] };
  const controlId = result.controls[0].controlId;
  for (const attribute of ["hidden", "data-agent-sensitive", "disabled"]) {
    element.setAttribute(attribute, "");
    await expect(execute("browser_activate", { controlId })).rejects.toThrow("CONTROL_UNAVAILABLE");
    element.removeAttribute(attribute);
  }
  element.remove();
  await expect(execute("browser_activate", { controlId })).rejects.toThrow("CONTROL_UNAVAILABLE");
  expect(clicked).not.toHaveBeenCalled();
});
