export type PatternCategory = "Theme";

export interface PatternEntry {
  /** Display name shown in sidebar and headings */
  name: string;
  /** URL slug used in /patterns/<slug> routes */
  slug: string;
  /** Grouping category for sidebar navigation */
  category: PatternCategory;
  /** Short description for overview cards */
  description: string;
}

export const patternRegistry: PatternEntry[] = [
  // Theme
  {
    name: "Theme Toggle",
    slug: "theme-toggle",
    category: "Theme",
    description: "Segmented control for switching between light, system, and dark themes.",
  },
];

/** Pattern categories in display order */
export const patternCategoryOrder: PatternCategory[] = ["Theme"];

/** Convert a pattern category name to a URL-friendly slug */
export function patternCategoryToSlug(category: PatternCategory): string {
  return category.toLowerCase().replace(/\s+/g, "-");
}

/** Resolve a URL slug back to a pattern category name */
export function slugToPatternCategory(
  slug: string,
): PatternCategory | undefined {
  return patternCategoryOrder.find((c) => patternCategoryToSlug(c) === slug);
}

/** Group pattern entries by category */
export function getPatternsByCategory(): Record<
  PatternCategory,
  PatternEntry[]
> {
  const grouped = {} as Record<PatternCategory, PatternEntry[]>;
  for (const cat of patternCategoryOrder) {
    grouped[cat] = patternRegistry.filter((c) => c.category === cat);
  }
  return grouped;
}
