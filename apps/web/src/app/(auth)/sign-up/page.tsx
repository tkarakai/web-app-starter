import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AppLogo } from "@/components/app-logo";

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3000";

export default function SignUpPage() {
  return (
    <main className="relative min-h-screen bg-[radial-gradient(circle_at_top,_rgba(210,230,255,0.65),_rgba(255,255,255,0.1)_50%,_transparent_80%)]">
      <Link
        href={LANDING_URL}
        className="absolute left-6 top-6 flex items-center gap-2 text-sm font-semibold text-foreground transition-opacity hover:opacity-80"
      >
        <AppLogo size={24} />
        <span>Web App Starter</span>
      </Link>
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Web App Starter
          </p>
          <h1 className="text-4xl font-semibold leading-tight">
            Create your account and start building.
          </h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            Convex + Better Auth are already wired, so your account is immediately
            production-ready.
          </p>
        </section>
        <AuthForm mode="sign-up" />
      </div>
    </main>
  );
}
