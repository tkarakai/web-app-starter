// Client-side auth UI and helpers. Server Components are in "./views", the proxy
// helper in "./proxy", and route handlers in "./routes".
export { AuthForm } from "./components/auth-form";
export { AccountPageCloseButton } from "./components/account-page-close-button";
export { AuthGuard, useAuthUser } from "./components/auth-guard";
export { ConvexErrorToast, errorMessageKey, PLATFORM_ERROR_KEYS } from "./components/convex-error-toast";
export { ForceSystemTheme } from "./components/force-system-theme";
export { ForgotPasswordForm } from "./components/forgot-password-form";
export { GuestGuard } from "./components/guest-guard";
export { InvitationSignupForm } from "./components/invitation-signup-form";
export { LocaleSwitcher } from "./components/locale-switcher";
export { CopyableField, StyledQrCode, OtpInput, PasskeyUnsupportedAlert, PasswordInput } from "./components/localized-controls";
export { ResetPasswordForm } from "./components/reset-password-form";
export { VerifyEmailForm } from "./components/verify-email-form";
export { broadcastAuth, onAuthBroadcast } from "./lib/auth-broadcast";
export { EMAIL_VERIFICATION_CALLBACK_URL } from "./lib/auth-callbacks";
export { redirectWithUserLocale } from "./lib/auth-locale";
export { parseOnboardingStatus, type OnboardingType } from "./lib/onboarding";
export { usePasswordStrength } from "./lib/use-password-strength";
export { useSignOut } from "./lib/use-sign-out";
export { useAccountNavigation } from "./lib/use-account-navigation";
export { AcceptInvitation, ResumeInvitation } from "./components/accept-invitation";
export { CreateOrganizationDialog } from "./components/create-organization-dialog";
export { OrganizationAccessNotice, OrganizationInvitations } from "./components/organization-invitations";
export { NoOrganization } from "./components/no-organization";
export { OrganizationSwitcher } from "./components/organization-switcher";
export { organizationErrorKey, useOrganizations, type OrganizationRole } from "./lib/organization";
export { OrganizationSection } from "./settings/organization-section";
export { ChangePasswordForm } from "./settings/change-password-form";
export { PasskeySection } from "./settings/passkey-section";
export { TwoFactorSection } from "./settings/two-factor-section";
export { SessionsList } from "./settings/sessions-list";
export { SecuritySection } from "./settings/security-section";
export { WaitlistForm, type WaitlistFormProps } from "./components/waitlist-form";

export { SessionAccessGate, AdminSessionAccessGate } from "./components/session-access-gate";
