"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";

import { api } from "@repo/backend";

/** Pages an administrator may use before a tenancy mode is chosen. */
const ALLOWED = ["/configure/tenancy", "/manage/plans", "/configure/setup-2fa", "/dashboard/setup-2fa", "/settings", "/dashboard/settings"];

/**
 * Until a tenancy mode is chosen nobody can sign up, so the admin app sends administrators to
 * the tenancy step (and the plans it needs) first.
 */
export function TenancyRequired() {
  const mode = useQuery(api.platform.tenancy.mode);
  const pathname = usePathname();
  const router = useRouter();
  const allowed = ALLOWED.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  React.useEffect(() => {
    if (mode && mode.mode === null && !allowed) router.replace("/configure/tenancy");
  }, [mode, allowed, router]);
  return null;
}
