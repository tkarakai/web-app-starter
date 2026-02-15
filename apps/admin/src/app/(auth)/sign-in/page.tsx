import Link from "next/link";

import { AdminSignInForm } from "@/components/auth/admin-sign-in-form";

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3000";

export default function SignInPage() {
  return (
    <main
      className="flex min-h-screen flex-col"
      style={{ background: "var(--glow-warm-intense)" }}
    >
      <header className="sticky top-[var(--env-banner-h,0px)] z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-6 py-4">
          <Link
            href={LANDING_URL}
            className="flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-muted-foreground"
          >
            <img src="/icon.svg" alt="App Icon" width={24} height={24} />
            <span>Web App Starter Administration</span>
          </Link>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-4">
        <AdminSignInForm />
      </div>
    </main>
  );
}
