"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";

import { authClient } from "@repo/auth/client";
import { broadcastAuth } from "@/lib/auth-broadcast";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
} from "@repo/design-system";

const LANDING_URL =
  process.env.NEXT_PUBLIC_LANDING_URL ?? "http://localhost:3000";

const copy = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in to continue to your dashboard.",
    cta: "Sign in",
    footer: "New here?",
    link: "/sign-up",
    linkLabel: "Create an account",
  },
  "sign-up": {
    title: "Create your workspace",
    description: "Get started in under a minute.",
    cta: "Create account",
    footer: "Already have access?",
    link: "/sign-in",
    linkLabel: "Sign in",
  },
} as const;

type AuthMode = keyof typeof copy;

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (mode === "sign-up" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setPending(true);

    try {
      if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: "/dashboard",
        });

        if (result.error) {
          setError(result.error.message ?? "An error occurred");
        } else {
          broadcastAuth();
          router.push("/dashboard");
        }
        return;
      }

      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/dashboard",
        rememberMe: true,
      });

      if (result.error) {
        setError(result.error.message ?? "An error occurred");
      } else {
        broadcastAuth();
        router.push("/dashboard");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          Account
        </div>
        <CardTitle className="text-2xl font-semibold">
          {copy[mode].title}
        </CardTitle>
        <CardDescription>{copy[mode].description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === "sign-up" ? (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Avery Quinn"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder={mode === "sign-in" ? "Your password" : "At least 8 characters"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              {...(mode === "sign-up" ? { minLength: 8 } : {})}
            />
          </div>
          {mode === "sign-up" ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
              />
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
              {error}
            </div>
          ) : null}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "Working..." : copy[mode].cta}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1 min-w-0 w-auto" />
            <span>Secure email + password</span>
            <Separator className="flex-1 min-w-0 w-auto" />
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => router.push(copy[mode].link)}
          >
            {copy[mode].footer}{" "}
            <span className="underline">{copy[mode].linkLabel}</span>
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            By continuing, you agree to our{" "}
            <a
              href={`${LANDING_URL}/terms`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href={`${LANDING_URL}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Privacy Policy
            </a>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
