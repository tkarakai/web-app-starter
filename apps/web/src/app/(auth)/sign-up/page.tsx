import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { Button } from "@repo/design-system";

export default function SignUpPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(210,230,255,0.65),_rgba(255,255,255,0.1)_50%,_transparent_80%)]">
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
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">Back to overview</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </section>
        <AuthForm mode="sign-up" />
      </div>
    </main>
  );
}
