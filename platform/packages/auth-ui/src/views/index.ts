// Server Components for an app's auth routes. Re-export them from the route files:
//   export { SignInView as default } from "@web-app-starter/auth-ui/views";
export {
  AuthPageShell,
  ForgotPasswordView,
  InvitationSignupView,
  ResetPasswordView,
  SignInView,
  SignUpView,
  VerifyEmailView,
} from "./auth-views";
export { AuthLayout, ForbiddenView, ProtectedLayout, PublicAuthLayout } from "./layouts";
