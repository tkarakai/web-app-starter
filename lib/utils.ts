import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Utility helper documented for team reuse across the starter project.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
