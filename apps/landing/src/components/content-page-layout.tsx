import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@repo/design-system";

interface ContentPageLayoutProps {
  title: string;
  notice?: string;
  children: React.ReactNode;
}

export function ContentPageLayout({
  title,
  notice,
  children,
}: ContentPageLayoutProps) {
  return (
    <div className="min-h-screen">
      <nav className="mx-auto flex max-w-3xl items-center px-6 py-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
      </nav>
      <main className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {notice ? (
          <Alert className="mb-8 mt-8">
            <Info className="h-4 w-4" />
            <AlertTitle>Note</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      </main>
    </div>
  );
}
