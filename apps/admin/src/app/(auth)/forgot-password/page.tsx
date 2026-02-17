import { SiteHeader } from "@repo/design-patterns";
import { AdminForgotPasswordForm } from "@/components/auth/admin-forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main
      className="flex min-h-screen flex-col"
      style={{ background: "var(--glow-warm-intense)" }}
    >
      <SiteHeader appName="Web App Starter Administration" />
      <div className="flex flex-1 items-center justify-center p-4 pt-20">
        <AdminForgotPasswordForm />
      </div>
    </main>
  );
}
