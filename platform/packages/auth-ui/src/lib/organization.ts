"use client";

import { useQuery } from "convex/react";

import { api } from "@repo/backend";

export type OrganizationRole = "owner" | "admin" | "member";

/** The caller's organizations and the active one: `undefined` while loading, `null` signed out. */
export function useOrganizations() {
  return useQuery(api.platform.organizations.mine);
}

const departing = new Set<string>();

/**
 * Mark an organization the user is leaving or deleting, so its disappearance from their
 * list reads as their own doing rather than as lost access (`EnsureOrganization`).
 */
export function expectOrganizationDeparture(organizationId: string): void {
  departing.add(organizationId);
}

/** True, once, for an organization passed to `expectOrganizationDeparture`. */
export function takeExpectedDeparture(organizationId: string): boolean {
  return departing.delete(organizationId);
}

const INVITATION_KEY = "organization-invitation";
const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Remember an invitation link opened while signed out, so the user returns to it after
 * signing in or signing up, however many steps that takes (`ResumeInvitation`).
 */
export function rememberInvitation(invitationId: string): void {
  try {
    window.localStorage.setItem(INVITATION_KEY, JSON.stringify({ id: invitationId, at: Date.now() }));
  } catch {
    // Storage unavailable: the invitation still waits on the dashboard banner.
  }
}

/** Forget the remembered invitation and return it if it is recent. */
export function takeRememberedInvitation(): string | null {
  try {
    const raw = window.localStorage.getItem(INVITATION_KEY);
    window.localStorage.removeItem(INVITATION_KEY);
    const saved = raw ? JSON.parse(raw) as { id?: unknown; at?: unknown } : null;
    if (typeof saved?.id !== "string" || typeof saved.at !== "number" || saved.at + INVITATION_TTL_MS < Date.now()) return null;
    return saved.id;
  } catch {
    return null;
  }
}

/**
 * The `organization.errors.*` message key for a Better Auth organization error.
 * Better Auth answers with `{ status, code }`; anything unrecognised is generic.
 */
export function organizationErrorKey(error: { status?: number; code?: string } | null | undefined):
  "rateLimited" | "notAllowed" | "alreadyMember" | "lastOwner" | "invalidEmail" | "generic" {
  if (!error) return "generic";
  const code = error.code ?? "";
  if (error.status === 429) return "rateLimited";
  if (code.includes("ONLY_OWNER") || code.includes("WITHOUT_AN_OWNER")) return "lastOwner";
  if (code.includes("ALREADY_A_MEMBER") || code.includes("ALREADY_INVITED")) return "alreadyMember";
  if (code.includes("INVALID_EMAIL") || code === "VALIDATION_ERROR") return "invalidEmail";
  if (error.status === 401 || error.status === 403 || code.includes("NOT_ALLOWED")) return "notAllowed";
  return "generic";
}

/** A slug Better Auth requires but the UI never shows: readable prefix, random suffix. */
export function organizationSlug(name: string): string {
  const base = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `${base || "org"}-${suffix}`;
}
