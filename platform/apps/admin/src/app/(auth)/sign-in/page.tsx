import { SiteHeader } from "@web-app-starter/design-patterns";
import { AdminSignInForm } from "@/components/auth/admin-sign-in-form";
import { appConfig } from "@web-app-starter/app-config";

export default function SignInPage() {
  return (
    <main
      className="flex min-h-[calc(100dvh-var(--env-banner-h,0px))] flex-col"
      style={{ background: "var(--glow-warm-intense)" }}
    >
      <SiteHeader appName={`${appConfig.identity.productName} Administration`} />
      <div className="flex flex-1 items-center justify-center p-4 pt-20">
        <AdminSignInForm />
      </div>
    </main>
  );
}
