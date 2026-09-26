import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { api } from "@repo/backend";
import {
  fetchAuthQuery,
  isAuthenticated,
  preloadAuthQuery,
} from "@web-app-starter/auth/server";
import { Button } from "@web-app-starter/design-system";

import { AuthGuard } from "../components/auth-guard";
import { ForceSystemTheme } from "../components/force-system-theme";
import { GuestGuard } from "../components/guest-guard";

const CLEAR_SESSION = "/api/auth/clear-session";

/** Layout for guest-only auth pages (sign-in, sign-up, forgot and reset password). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <GuestGuard>
      <ForceSystemTheme />
      {children}
    </GuestGuard>
  );
}

/** Layout for pages any visitor may reach while signed in or out (invitation, verify email). */
export function PublicAuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ForceSystemTheme />
      {children}
    </>
  );
}

/**
 * Layout for signed-in pages. Validates the session server-side, preloads the current
 * user for `useAuthUser()`, and enforces the platform's access rules:
 * no session or a stale one → clear-session (then sign-in); admins and banned users →
 * `/forbidden`; `userMfaRequired` policy without 2FA → security settings.
 */
export async function ProtectedLayout({ children }: { children: ReactNode }) {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect(CLEAR_SESSION);
  }

  let preloadedUser;
  try {
    preloadedUser = await preloadAuthQuery(api.platform.auth.getCurrentUser);
  } catch {
    redirect(CLEAR_SESSION);
  }

  const user = await fetchAuthQuery(api.platform.auth.getCurrentUser);
  if (!user) {
    redirect(CLEAR_SESSION);
  }

  const userRecord = user as Record<string, unknown>;

  // Admins cannot use the web app (spec §14)
  if (userRecord.role === "admin") {
    redirect("/forbidden");
  }

  // Banned users cannot access the dashboard (spec §14)
  if (userRecord.banned === true) {
    redirect("/forbidden");
  }

  // Server-side MFA enforcement: if userMfaRequired policy is enabled and
  // the user hasn't set up 2FA, redirect to settings security tab.
  if (userRecord.twoFactorEnabled !== true) {
    try {
      const mfaRequired = await fetchAuthQuery(api.platform.appSettings.getPublic, {
        key: "userMfaRequired",
      });
      if (mfaRequired === true) {
        redirect("/dashboard/settings?tab=security&enforce=mfa");
      }
    } catch {
      // If the query fails, fall through — client-side AuthGuard
      // will enforce MFA as a secondary check.
    }
  }

  return <AuthGuard preloadedUser={preloadedUser}>{children}</AuthGuard>;
}

/** Default `/forbidden` page: shown to admins and banned users who reach the web app. */
export async function ForbiddenView() {
  const t = await getTranslations("forbidden");
  const user = await fetchAuthQuery(api.platform.auth.getCurrentUser).catch(
    () => null,
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-4xl font-bold">{t("title")}</h1>
        {user?.email && (
          <p className="text-primary text-sm font-bold">
            {t("signedInAs", { email: user.email })}
          </p>
        )}
        <p className="text-muted-foreground">{t("description")}</p>
        <Button asChild variant="outline">
          <a href={CLEAR_SESSION}>{t("backToSignIn")}</a>
        </Button>
      </div>
    </main>
  );
}
