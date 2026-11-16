import * as React from "react";
import { cn } from "@web-app-starter/design-system";

/**
 * A standalone auth page's title: the card title's look, as the page's h1. A CardTitle (an h3)
 * with no heading above it fails axe's heading-order rule, and the page has no h1 (#416).
 */
export function PageTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 data-slot="card-title" className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}
