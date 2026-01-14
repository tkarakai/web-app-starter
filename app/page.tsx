import { MessageBoard } from "@/components/message-board";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-blue">
            Web App Starter
          </p>
          <h1 className="text-4xl font-semibold text-slate-900">
            Launch faster with Next.js, Bun, Convex, and BetterAuth
          </h1>
          <p className="text-base text-slate-600">
            This template ships with a ready-to-run Convex backend, a polished Tailwind
            foundation, and BetterAuth scaffolding so you can focus on product work.
          </p>
        </header>

        <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Starter checklist</h2>
          <ol className="grid gap-2 text-sm text-slate-700">
            <li>1. Add your Convex deployment URL to <code>.env.local</code>.</li>
            <li>2. Run <code>bunx convex dev</code> to generate API types.</li>
            <li>3. Configure BetterAuth providers in <code>lib/auth.ts</code>.</li>
          </ol>
        </section>

        <MessageBoard />
      </div>
    </main>
  );
}
