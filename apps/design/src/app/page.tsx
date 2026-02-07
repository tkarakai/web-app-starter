import Link from "next/link";
import { Badge, Card, CardContent, Separator } from "@repo/ui";

import {
  categoryOrder,
  getComponentsByCategory,
} from "@/lib/registry";

const categoryColors: Record<string, string> = {
  Actions: "bg-primary/10 text-primary",
  "Data Display": "bg-accent/10 text-accent",
  Feedback: "bg-destructive/10 text-destructive",
  Form: "bg-primary/10 text-primary",
  Layout: "bg-secondary text-secondary-foreground",
  Overlay: "bg-muted text-muted-foreground",
};

export default function DesignHome() {
  const grouped = getComponentsByCategory();
  const totalComponents = Object.values(grouped).flat().length;

  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="space-y-4">
        <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.15em]">
          Design System
        </Badge>
        <h1 className="font-serif text-5xl tracking-tight text-foreground leading-[1.1]">
          UI Components
        </h1>
        <p className="max-w-lg text-base text-muted-foreground leading-relaxed">
          {totalComponents} production-ready components built with Radix UI and Tailwind CSS.
          Accessible, themeable, and composable.
        </p>
        <Separator className="mt-6" />
      </div>

      {/* Component grid by category */}
      {categoryOrder.map((category) => (
        <section key={category}>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
              {category}
            </h2>
            <span className="text-[10px] text-muted-foreground/60">{grouped[category].length}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grouped[category].map((entry) => (
              <Link
                key={entry.slug}
                href={`/components/${entry.slug}`}
                className="group"
              >
                <Card className="h-full transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">
                        {entry.name}
                      </h3>
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${categoryColors[category] ?? "bg-muted text-muted-foreground"}`}>
                        {category}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
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
