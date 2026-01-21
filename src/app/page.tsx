import Link from "next/link";
import { ArrowUpRight, Database, Layers, ShieldCheck, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const pillars = [
  {
    title: "Next.js 16 + React 19",
    description: "App Router, streaming, and modern routing conventions out of the box.",
    icon: Layers,
  },
  {
    title: "Convex as the backend",
    description: "Database, file storage, and realtime APIs live in Convex functions.",
    icon: Database,
  },
  {
    title: "Better Auth",
    description: "Email/password flows wired to Convex for secure sessions.",
    icon: ShieldCheck,
  },
  {
    title: "Bun-first workflow",
    description: "Use Bun for runtime, package management, and testing.",
    icon: Zap,
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,225,184,0.55),_rgba(255,255,255,0.2)_45%,_transparent_80%)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 pb-24 pt-16">
        <section className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Launchpad starter
              <Badge variant="secondary">Convex + Better Auth</Badge>
            </div>
            <h1 className="text-5xl font-semibold leading-[1.05]">
              A bold baseline for your next web app build.
            </h1>
            <p className="max-w-xl text-base text-muted-foreground">
              This starter wires Next.js, Bun, Tailwind, shadcn/ui, Convex, and Better
              Auth into a cohesive launchpad. Clone it, adjust the domain tone, and start
              shipping features immediately.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/sign-up">
                  Start a workspace
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard">View dashboard</Link>
              </Button>
            </div>
            <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div>- Realtime Convex queries + mutations</div>
              <div>- Auth proxy + session-aware SSR</div>
              <div>- File uploads with Convex storage</div>
              <div>- Bun test runner + conventions baked in</div>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -right-6 top-6 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
            <div className="absolute bottom-0 left-10 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
            <Card className="relative border-border/60 bg-card/80 shadow-xl shadow-primary/10">
              <CardHeader>
                <CardTitle className="text-lg">Starter status</CardTitle>
                <CardDescription>
                  The running app already includes working auth, data, and file flows.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <span>Auth provider</span>
                  <Badge>Better Auth</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Database</span>
                  <Badge variant="secondary">Convex</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>UI system</span>
                  <Badge variant="outline">Tailwind + shadcn/ui</Badge>
                </div>
                <div className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                  Jump into <code className="font-semibold">/dashboard</code> after signing
                  in to see the live Convex queries and mutations.
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <Card key={pillar.title} className="border-border/60 bg-card/80">
                <CardHeader className="flex flex-row items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-5 w-5 text-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{pillar.title}</CardTitle>
                    <CardDescription>{pillar.description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/60 bg-card/80">
            <CardHeader>
              <CardTitle className="text-xl">What you get, right away</CardTitle>
              <CardDescription>
                A production-shaped skeleton with sample flows you can remix.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm text-muted-foreground">
              <div>
                <span className="font-semibold text-foreground">Auth-ready UI</span> - Sign up
                and sign in pages wired to Better Auth client methods.
              </div>
              <div>
                <span className="font-semibold text-foreground">Convex API layer</span> -
                Launch items, uploads, and health queries all run through Convex functions.
              </div>
              <div>
                <span className="font-semibold text-foreground">Realtime dashboards</span> -
                Convex queries update the UI without manual polling.
              </div>
              <div>
                <span className="font-semibold text-foreground">Documented conventions</span> -
                Coding, testing, documentation, and DevOps guardrails are included.
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/80">
            <CardHeader>
              <CardTitle className="text-xl">Next steps</CardTitle>
              <CardDescription>Ready-to-follow workflow for new teams.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <ol className="space-y-2">
                <li>1. Run <code className="font-semibold">bun install</code>.</li>
                <li>2. Start Convex with <code className="font-semibold">bunx convex dev</code>.</li>
                <li>3. Set Better Auth secrets in Convex.</li>
                <li>4. Run <code className="font-semibold">bun run dev</code>.</li>
              </ol>
              <Button variant="outline" asChild className="w-full">
                <Link href="/dashboard">Open the dashboard demo</Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
