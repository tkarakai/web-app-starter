import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility from shadcn/ui that merges class names in a Tailwind-friendly way.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
