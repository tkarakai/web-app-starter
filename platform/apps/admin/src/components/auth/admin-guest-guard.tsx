"use client";
import { GuestGuard } from "@web-app-starter/auth-ui";
import { postSignInPath } from "@/lib/agentic/return-path";
export function AdminGuestGuard({ children }: { children: React.ReactNode }) {
  return <GuestGuard getRedirectPath={postSignInPath}>{children}</GuestGuard>;
}
