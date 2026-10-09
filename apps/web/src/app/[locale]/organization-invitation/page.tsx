import type { Metadata } from "next";
import { InvitationClient } from "@/components/organizations/invitation-client";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };
export default function OrganizationInvitationPage() { return <InvitationClient />; }
