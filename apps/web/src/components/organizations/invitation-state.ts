export interface SavedOrganizationInvitation { organizationId: string; token: string; capability?: string; email?: string }
const storageKey = "pending-organization-invitation";
export function parseOrganizationInvitation(fragment: string): SavedOrganizationInvitation | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const organizationId = params.get("organizationId"); const token = params.get("token");
  if (!organizationId || organizationId.length > 256 || !token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return { organizationId, token };
}
export function saveOrganizationInvitation(invitation: SavedOrganizationInvitation) {
  try { window.sessionStorage.setItem(storageKey, JSON.stringify(invitation)); } catch { /* In-memory flow still works. */ }
}
export function readOrganizationInvitation(): SavedOrganizationInvitation | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as SavedOrganizationInvitation | null;
    if (!value) return null;
    const valid = parseOrganizationInvitation(new URLSearchParams({ organizationId: value.organizationId, token: value.token }).toString());
    return valid ? { ...valid, ...(typeof value.capability === "string" && /^[a-f0-9]{64}$/.test(value.capability) ? { capability: value.capability, email: value.email } : {}) } : null;
  } catch { return null; }
}
export function clearOrganizationInvitation() { try { window.sessionStorage.removeItem(storageKey); } catch { /* No persisted state. */ } }
