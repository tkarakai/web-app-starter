import type { ComponentType } from "react";

import SiteHeaderShowcase from "./site-header";
import ThemeToggleShowcase from "./theme-toggle";
import TimezoneSelectorShowcase from "./timezone-selector";

export const patternShowcaseMap: Record<string, ComponentType> = {
  "site-header": SiteHeaderShowcase,
  "theme-toggle": ThemeToggleShowcase,
  "timezone-selector": TimezoneSelectorShowcase,
};
