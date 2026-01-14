import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface FeatureCardProps {
  title: string;
  description: string;
  icon?: ReactNode;
  className?: string;
}

// Documented, reusable card component to anchor UI conventions.
export function FeatureCard({
  title,
  description,
  icon,
  className,
}: FeatureCardProps) {
  return (
    <article
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-6 shadow-sm",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
            {icon}
          </div>
        ) : null}
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm text-slate-600">{description}</p>
        </div>
      </div>
    </article>
  );
}
