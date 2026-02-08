import { Badge, Button } from "@repo/design-system";

const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL ?? "http://localhost:3001";

export default function HomePage() {
  return (
    <main
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--glow-warm)" }}
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-6 text-center">
        <Badge variant="secondary" className="text-xs uppercase tracking-widest">
          Next.js + Convex + Better Auth
        </Badge>

        <h1 className="text-5xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
          Your starting line.
          <br />
          Build from here.
        </h1>

        <p className="max-w-lg text-base text-muted-foreground">
          Auth, database, real-time sync, and file uploads — wired and ready.
        </p>

        <div className="flex gap-3">
          <Button asChild>
            <a href={`${WEB_APP_URL}/sign-up`}>Get started</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`${WEB_APP_URL}/sign-in`}>Sign in</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
