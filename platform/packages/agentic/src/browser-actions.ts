/* global Document, Element, NodeFilter, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, HTMLAnchorElement, Event */
/** Operate only visible controls already rendered by the application; never evaluate agent code. */
import { browserContracts } from "./browser-contract";
const browserNames = new Set<string>(browserContracts.map(contract => contract.name));
export function browserActions(document: Document, navigate: (path: string) => void) {
  let sequence = 0;
  const registrationId = crypto.randomUUID();
  const controls = new Map<string, HTMLElement>(); const ids = new WeakMap<HTMLElement, string>();
  const secret = (element: Element) => Boolean(element.closest('[data-agent-sensitive], [hidden], [aria-hidden="true"], script, style, noscript'))
    || element.matches('input[type="password"], input[autocomplete="one-time-code"], input[autocomplete="current-password"], input[autocomplete="new-password"], input[name*="token" i], input[name*="secret" i]');
  const visible = (element: HTMLElement) => !secret(element) && element.getClientRects().length > 0 && (!element.checkVisibility || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
  // Every textual projection shares this boundary, including referenced labels
  // and rows that contain a mix of public and protected descendants.
  function visibleText(element: HTMLElement | null) {
    if (!element || !visible(element)) return "";
    const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const texts: string[] = [];
    while (nodes.nextNode()) {
      const parent = nodes.currentNode.parentElement;
      if (parent && visible(parent) && nodes.currentNode.textContent?.trim()) texts.push(nodes.currentNode.textContent.trim());
    }
    return texts.join("\n");
  }
  function nameOf(element: HTMLElement) {
    const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map(id => visibleText(document.getElementById(id))).join(" ");
    const labels = "labels" in element ? Array.from((element as HTMLInputElement).labels ?? []).map(label => visibleText(label)).join(" ") : "";
    return (element.getAttribute("aria-label") || labelled || labels || element.getAttribute("placeholder") || element.getAttribute("title") || visibleText(element)).trim().slice(0, 160);
  }
  function safeControl(id: unknown) {
    const element = typeof id === "string" ? controls.get(id) : null;
    if (!element?.isConnected || !visible(element) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") throw new Error("CONTROL_UNAVAILABLE: read the current page again");
    return element;
  }
  return async function execute(name: string, input: Record<string, unknown>) {
    // The authenticated backend prepared/validated these arguments against the shared schema.
    if (!browserNames.has(name)) throw new Error("UNKNOWN_CAPABILITY");
    const args = input;
    if (name === "browser_readPage") {
      for (const [id, element] of controls) if (!element.isConnected) controls.delete(id);
      const modal = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')).reverse().find(element => element.getClientRects().length > 0 && (!element.checkVisibility || element.checkVisibility()));
      if (modal && secret(modal)) return { status: "requires_user_action", executed: false, text: "A credential/security ceremony is open. Complete it in the secure UI; its contents are excluded." };
      const scope = modal ?? document.body;
      const text = visibleText(scope); const offset = args.offset as number; const controlsOffset = args.controlsOffset as number;
      const elements = Array.from(scope.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="combobox"]')).filter(visible);
      const candidates = elements.slice(controlsOffset, controlsOffset + 40).map(element => {
        let id = ids.get(element); if (!id) { id = `control-${registrationId}-${++sequence}`; ids.set(element, id); } controls.set(id, element);
        const row = element.closest<HTMLElement>('tr, [role="row"], [data-agent-record]');
        return { controlId: id, row: row ? visibleText(row).slice(0, 240) : undefined, expanded: element.getAttribute("aria-expanded") ?? undefined, selected: element.getAttribute("aria-selected") ?? undefined, role: element.getAttribute("role") || element.tagName.toLowerCase(), name: nameOf(element), disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true", checked: element.getAttribute("aria-checked") ?? (element instanceof HTMLInputElement && element.type === "checkbox" ? String(element.checked) : undefined), value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element.value.slice(0, 500) : undefined };
      });
      const page = { path: document.location.pathname, title: document.title.slice(0, 160), text: text.slice(offset, offset + 5000) };
      const rows: typeof candidates = [];
      for (const candidate of candidates) {
        if (JSON.stringify({ ...page, controls: [...rows, candidate] }).length > 10_000) break;
        rows.push(candidate);
      }
      return { ...page, controls: rows, nextOffset: offset + 5000 < text.length ? offset + 5000 : null, nextControlsOffset: controlsOffset + rows.length < elements.length ? controlsOffset + rows.length : null };
    }
    if (name === "browser_navigate") {
      const requested = args.path as string;
      if (!requested.startsWith("/") || requested.startsWith("//") || requested.includes("\\")) throw new Error("INVALID_ADMIN_PATH");
      const normalized = new URL(decodeURIComponent(requested), document.location.origin);
      const path = normalized.pathname + normalized.search + normalized.hash;
      if (normalized.origin !== document.location.origin || !/^\/(dashboard|manage|configure|monitor|settings)(\/|\?|$)/.test(path) || path.startsWith("//") || path.includes("\\") || path.startsWith("/settings/agent-access")) throw new Error("INVALID_ADMIN_PATH");
      navigate(path); return { status: "navigation_started", path };
    }
    if (name === "browser_scroll") { document.defaultView?.scrollTo({ top: args.top as number }); return { scrolled: true }; }
    if (name === "browser_reload") { document.location.reload(); return { status: "reload_started" }; }
    const element = safeControl(args.controlId);
    if (name === "browser_activate") {
      if (element instanceof HTMLAnchorElement) {
        const url = new URL(element.href, document.location.href);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("INVALID_ADMIN_PATH");
        if (url.origin !== document.location.origin) return { status: "requires_user_action", url: url.protocol === "https:" ? url.href : undefined, executed: false };
      }
      element.click(); return { status: "control_activated" };
    }
    if (name === "browser_toggle") {
      if (!(element instanceof HTMLInputElement && element.type === "checkbox") && !["checkbox", "switch"].includes(element.getAttribute("role") ?? "")) throw new Error("NOT_TOGGLE");
      const checked = element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true";
      if (checked !== args.checked) element.click(); return { status: "toggle_requested", checked: args.checked };
    }
    if (name === "browser_select") {
      if (!(element instanceof HTMLSelectElement) || !Array.from(element.options).some(option => option.value === args.value && !option.disabled)) throw new Error("INVALID_SELECT_OPTION");
      element.value = args.value as string; element.dispatchEvent(new Event("change", { bubbles: true })); return { status: "selection_changed" };
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.readOnly || element instanceof HTMLInputElement && !["text", "email", "search", "url", "number", "datetime-local", "date", "time", "tel"].includes(element.type)) throw new Error("FIELD_NOT_EDITABLE");
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, args.value);
      element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (element.isContentEditable) { element.textContent = args.value as string; element.dispatchEvent(new Event("input", { bubbles: true })); }
    else throw new Error("FIELD_NOT_EDITABLE");
    return { status: "draft_changed", saved: false };
  };
}
