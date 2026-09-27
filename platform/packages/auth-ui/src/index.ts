// Client-side auth UI and helpers. Server Components are in "./views", the proxy
// helper in "./proxy", and route handlers in "./routes".
export { AuthForm } from "./components/auth-form";
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
export { ChangePasswordForm } from "./settings/change-password-form";
export { PasskeySection } from "./settings/passkey-section";
export { TwoFactorSection } from "./settings/two-factor-section";
export { SessionsList } from "./settings/sessions-list";
export { SecuritySection } from "./settings/security-section";
