"use client";

import { useEffect, useSyncExternalStore } from "react";

const eventName = "organization-context-changed";
const key = (userId: string) => `organization-context:${userId}`;
function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener);
  window.addEventListener("popstate", listener);
  return () => { window.removeEventListener(eventName, listener); window.removeEventListener("popstate", listener); };
}
export function readOrganizationSelection(userId: string | null): string | null {
  if (!userId || typeof window === "undefined") return null;
  const link = new URL(window.location.href).searchParams.get("organizationId");
  if (link !== null) return link; // Even an invalid explicit link must not select another organization.
  try { return window.sessionStorage.getItem(key(userId)); } catch { return null; }
}
export function selectOrganization(userId: string, organizationId: string) {
  if (!organizationId) throw new Error("EXPLICIT_ORGANIZATION_CONTEXT_REQUIRED");
  try { window.sessionStorage.setItem(key(userId), organizationId); } catch { /* URL still binds this tab. */ }
  const url = new URL(window.location.href);
  url.searchParams.set("organizationId", organizationId);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(eventName));
}
export function useOrganizationSelection(userId: string | null) {
  const selected = useSyncExternalStore(subscribe, () => readOrganizationSelection(userId), () => null);
  useEffect(() => {
    // Preserve an explicit deep link across navigation in this tab. Authorization
    // still comes from the live membership snapshot, including for invalid IDs.
    if (userId && selected !== null) {
      try { window.sessionStorage.setItem(key(userId), selected); } catch { /* URL remains authoritative for this view. */ }
    }
  }, [userId, selected]);
  return selected;
}
