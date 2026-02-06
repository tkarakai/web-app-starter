export type ComponentCategory =
  | "Actions"
  | "Display"
  | "Form"
  | "Layout"
  | "Overlay";

export interface ComponentEntry {
  /** Display name shown in sidebar and headings */
  name: string;
  /** URL slug used in /components/<slug> routes */
  slug: string;
  /** Grouping category for sidebar navigation */
  category: ComponentCategory;
  /** Short description for overview cards */
  description: string;
}

export const componentRegistry: ComponentEntry[] = [
  // Actions
  {
    name: "Button",
    slug: "button",
    category: "Actions",
    description: "Trigger actions and events.",
  },

  // Display
  {
    name: "Avatar",
    slug: "avatar",
    category: "Display",
    description: "User profile images with fallbacks.",
  },
  {
    name: "Badge",
    slug: "badge",
    category: "Display",
    description: "Status indicators and labels.",
  },
  {
    name: "Progress",
    slug: "progress",
    category: "Display",
    description: "Show completion progress.",
  },
  {
    name: "Separator",
    slug: "separator",
    category: "Display",
    description: "Visual divider between content.",
  },

  // Form
  {
    name: "Input",
    slug: "input",
    category: "Form",
    description: "Single-line text input field.",
  },
  {
    name: "Label",
    slug: "label",
    category: "Form",
    description: "Accessible label for form controls.",
  },
  {
    name: "Textarea",
    slug: "textarea",
    category: "Form",
    description: "Multi-line text input field.",
  },

  // Layout
  {
    name: "Card",
    slug: "card",
    category: "Layout",
    description: "Container for grouped content.",
  },
  {
    name: "Tabs",
    slug: "tabs",
    category: "Layout",
    description: "Organize content into switchable panels.",
  },

  // Overlay
  {
    name: "Dialog",
    slug: "dialog",
    category: "Overlay",
    description: "Modal dialog for focused interactions.",
  },
  {
    name: "Dropdown Menu",
    slug: "dropdown-menu",
    category: "Overlay",
    description: "Contextual menu with actions.",
  },
  {
    name: "Tooltip",
    slug: "tooltip",
    category: "Overlay",
    description: "Informational popup on hover.",
  },
];

/** Categories in display order */
export const categoryOrder: ComponentCategory[] = [
  "Actions",
  "Display",
  "Form",
  "Layout",
  "Overlay",
];

/** Group registry entries by category */
export function getComponentsByCategory(): Record<
  ComponentCategory,
  ComponentEntry[]
> {
  const grouped = {} as Record<ComponentCategory, ComponentEntry[]>;
  for (const cat of categoryOrder) {
    grouped[cat] = componentRegistry.filter((c) => c.category === cat);
  }
  return grouped;
}
