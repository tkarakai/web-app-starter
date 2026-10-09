"use client";

import { Component, type ReactNode } from "react";
import { useSignOut } from "@web-app-starter/auth-ui";
import { Badge, Button } from "@web-app-starter/design-system";
import messages from "@/messages/en.json";

export const copy = messages.adminOrganizations;
export type OrganizationSummary = {
  organizationId: string; name: string; lifecycle?: string; experience?: string; createdAt?: number;
};
export type OrganizationDetail = OrganizationSummary & { contacts: Array<{ name: string; email: string }> };
export type OrganizationPage = { page: OrganizationSummary[]; isDone: boolean; continueCursor: string };

export function Availability({ value }: { value?: string }) {
  const label = value === "active" ? copy.active : value === "disabled" ? copy.disabled
    : value === "provisioning" ? copy.provisioning : copy.unknown;
  return <Badge variant={value === "disabled" ? "destructive" : "secondary"}>{label}</Badge>;
}
export function experienceLabel(value?: string) {
  return value === "personal" ? copy.personal : value === "collaborative" ? copy.membershipEnabled : copy.unknown;
}
export function SignInAgain() {
  const signOut = useSignOut("/sign-in");
  return <Button variant="outline" onClick={() => void signOut()}>{copy.signInAgain}</Button>;
}
export function OrganizationUnavailable({ detail = false }: { detail?: boolean }) {
  return <div role="alert" className="space-y-4 rounded-lg border p-6">
    <p className="text-sm text-muted-foreground">{detail ? copy.unavailable : copy.accessLost}</p>
    <SignInAgain />
  </div>;
}
/** Query exceptions never render raw server errors or keep stale rows/dialog portals mounted. */
export class OrganizationBoundary extends Component<{ children: ReactNode; detail?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <OrganizationUnavailable detail={this.props.detail} /> : this.props.children; }
}
