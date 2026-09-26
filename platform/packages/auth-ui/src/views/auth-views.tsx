import { Suspense, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { appConfig } from "@web-app-starter/app-config";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@web-app-starter/design-system";
import { SiteHeader } from "@web-app-starter/design-patterns";

import { AuthForm } from "../components/auth-form";
import { ForgotPasswordForm } from "../components/forgot-password-form";
import { InvitationSignupForm } from "../components/invitation-signup-form";
import { LocaleSwitcher } from "../components/locale-switcher";
import { ResetPasswordForm } from "../components/reset-password-form";
import { VerifyEmailForm } from "../components/verify-email-form";
import { fetchOnboardingType } from "../lib/onboarding";

/** The marketing site URL for the header's home link, read at request time. */
function landingUrl(): string {
  const url = process.env.LANDING_URL;
  if (!url) {
    throw new Error("Missing required environment variable: LANDING_URL");
  }
  return url;
}

interface AuthPageShellProps {
  /** Heading namespace: `pageHeading` and `pageDescription` are read from it. */
  namespace: string;
  /** Page background (a design-token glow). */
  background: string;
  /** Extra header actions; the locale switcher is always shown. */
  headerActions?: ReactNode;
  /** Use `min-h-screen` instead of the banner-aware height. */
  fullScreen?: boolean;
  children: ReactNode;
}

/** The two-column layout every auth page shares: product intro left, form right. */
export async function AuthPageShell({ namespace, background, headerActions, fullScreen, children }: AuthPageShellProps) {
  const t = await getTranslations(namespace);
  const productName = appConfig.identity.productName;

  return (
    <main
      className={fullScreen ? "flex min-h-screen flex-col" : "flex min-h-[calc(100dvh-var(--env-banner-h,0px))] flex-col"}
      style={{ background }}
    >
      <SiteHeader
        appName={productName}
        homeHref={landingUrl()}
        actions={<>{headerActions}<LocaleSwitcher /></>}
      />
      <div className="mx-auto grid flex-1 max-w-6xl items-start justify-items-center gap-12 px-6 pb-16 pt-[calc(6rem+var(--announcement-banner-h,0px))] lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:justify-items-stretch">
        <section className="w-full max-w-md space-y-6 lg:max-w-none">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            {productName}
          </p>
          <h1 className="text-4xl font-semibold leading-tight">
            {t("pageHeading")}
          </h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            {t("pageDescription")}
          </p>
        </section>
        {children}
      </div>
    </main>
  );
}

/** Default sign-in page: `export { SignInView as default } from "@web-app-starter/auth-ui/views"`. */
export async function SignInView() {
  return (
    <AuthPageShell namespace="auth.signIn" background="var(--glow-warm-intense)">
      <AuthForm mode="sign-in" />
    </AuthPageShell>
  );
}

/**
 * Default sign-up page. Shows the form in public-signup mode; otherwise explains that
 * sign-up is closed and links to the waitlist (landing) or sign-in.
 */
export async function SignUpView() {
  const ts = await getTranslations("auth.signIn");
  const ti = await getTranslations("auth.invitation");
  const onboardingType = await fetchOnboardingType();
  const landing = landingUrl();

  return (
    <AuthPageShell namespace="auth.signUp" background="var(--glow-cool)">
      {onboardingType === "publicSignup" ? (
        <AuthForm mode="sign-up" />
      ) : (
        <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
          <CardHeader>
            <CardTitle>{ti("signupBlocked")}</CardTitle>
            <CardDescription>
              {onboardingType === "publicWaitlist"
                ? ti("signupBlockedDescription")
                : ts("description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              {onboardingType === "publicWaitlist" ? (
                <a href={landing}>{ti("goToWaitlist")}</a>
              ) : (
                <a href="/sign-in">{ts("cta")}</a>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </AuthPageShell>
  );
}

/** Default forgot-password page. */
export async function ForgotPasswordView() {
  return (
    <AuthPageShell namespace="auth.forgotPassword" background="var(--glow-brand)">
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}

interface ResetPasswordViewProps {
  searchParams: Promise<{ token?: string; error?: string }>;
}

/** Default reset-password page (the link in the reset email). */
export async function ResetPasswordView({ searchParams }: ResetPasswordViewProps) {
  const { token, error } = await searchParams;
  return (
    <AuthPageShell namespace="auth.resetPassword" background="var(--glow-brand)">
      <ResetPasswordForm token={token} error={error} />
    </AuthPageShell>
  );
}

/** Default verify-email page (the link in the verification email, and the resend form). */
export async function VerifyEmailView() {
  return (
    <AuthPageShell namespace="auth.verifyEmail" background="var(--glow-cool)" fullScreen>
      <Suspense fallback={null}>
        <VerifyEmailForm />
      </Suspense>
    </AuthPageShell>
  );
}

interface InvitationSignupViewProps {
  searchParams: Promise<{ token?: string }>;
}

/** Default invitation sign-up page (the link in a waitlist invitation). */
export async function InvitationSignupView({ searchParams }: InvitationSignupViewProps) {
  const { token } = await searchParams;
  return (
    <AuthPageShell namespace="auth.invitation" background="var(--glow-cool)">
      <InvitationSignupForm token={token} />
    </AuthPageShell>
  );
}
