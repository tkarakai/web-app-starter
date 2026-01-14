import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FileList } from "@/components/file-list";
import { FileUpload } from "@/components/file-upload";
import { MessageForm } from "@/components/message-form";
import { MessageList } from "@/components/message-list";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Web App Starter
        </p>
        <h1 className="text-3xl font-semibold md:text-4xl">
          A clean foundation for your next production app.
        </h1>
        <p className="text-base text-muted-foreground">
          This starter ships with Next.js, Bun, Tailwind + shadcn/ui, Convex, and
          BetterAuth wired together. Use it as a template and replace the sample
          "Message Board" feature with your real product.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <Link href="/auth">Try authentication</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="https://docs.convex.dev" target="_blank" rel="noreferrer">
              Convex docs
            </Link>
          </Button>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Message Board</h2>
          <p className="text-sm text-muted-foreground">
            Live updates powered by Convex queries and mutations.
          </p>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <MessageForm />
          <MessageList />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">File Storage</h2>
          <p className="text-sm text-muted-foreground">
            Upload files directly to Convex storage and keep metadata in the
            database.
          </p>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <FileUpload />
          <FileList />
        </div>
      </section>
    </main>
  );
}
