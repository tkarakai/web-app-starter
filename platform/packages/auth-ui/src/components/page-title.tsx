import * as React from "react";
import { cn } from "@web-app-starter/design-system";

/**
 * The card title of a standalone auth page: the card title's look, as an h2 under the auth page
 * shell's h1. A CardTitle is an h3, and an h1 followed by an h3 fails axe's heading-order (#416).
 */
export function PageTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}
