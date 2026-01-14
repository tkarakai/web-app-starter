"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function handleEmailSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Signing in...");

    try {
      // BetterAuth exposes an email/password helper on the client.
      // The exact API may differ per version; consult BetterAuth docs if you customize providers.
      await (authClient as any).signIn.email({
        email,
        password
      });
      setStatus("Signed in! Check your session.");
    } catch (error) {
      setStatus("Sign-in failed. Check your credentials.");
      console.error(error);
    }
  }

  async function handleGithubSignIn() {
    setStatus("Redirecting to GitHub...");
    await (authClient as any).signIn.social({ provider: "github" });
  }

  async function handleSignOut() {
    setStatus("Signing out...");
    await (authClient as any).signOut();
    setStatus("Signed out.");
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Authentication</h1>
        <p className="text-sm text-muted-foreground">
          This page demonstrates BetterAuth wiring for email/password and GitHub OAuth.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <form onSubmit={handleEmailSignIn} className="space-y-4">
          <div className="grid gap-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
          <Button type="submit">Sign in with email</Button>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={handleGithubSignIn}>
            Continue with GitHub
          </Button>
          <Button type="button" variant="outline" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
        {status ? (
          <p className="mt-3 text-sm text-muted-foreground">{status}</p>
        ) : null}
      </section>
    </main>
  );
}
