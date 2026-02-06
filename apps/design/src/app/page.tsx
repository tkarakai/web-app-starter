import Link from "next/link";
import { Card, CardContent } from "@repo/ui";

import {
  categoryOrder,
  getComponentsByCategory,
} from "@/lib/registry";

export default function DesignHome() {
  const grouped = getComponentsByCategory();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">UI Components</h1>
        <p className="mt-2 text-muted-foreground">
          Interactive showcase for the @repo/ui design system.
        </p>
      </div>

      {categoryOrder.map((category) => (
        <section key={category}>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            {category}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grouped[category].map((entry) => (
              <Link
                key={entry.slug}
                href={`/components/${entry.slug}`}
                className="group"
              >
                <Card className="h-full transition-colors hover:border-primary/40 hover:shadow-md">
                  <CardContent className="p-5">
                    <h3 className="font-semibold group-hover:text-primary transition-colors">
                      {entry.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {entry.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
