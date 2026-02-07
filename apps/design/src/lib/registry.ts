export type ComponentCategory =
  | "Actions"
  | "Data Display"
  | "Feedback"
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
    description: "Trigger actions and events with multiple variants.",
  },
  {
    name: "Toggle",
    slug: "toggle",
    category: "Actions",
    description: "Two-state toggle button.",
  },

  // Data Display
  {
    name: "Avatar",
    slug: "avatar",
    category: "Data Display",
    description: "User profile images with fallbacks.",
  },
  {
    name: "Badge",
    slug: "badge",
    category: "Data Display",
    description: "Status indicators and labels.",
  },
  {
    name: "Progress",
    slug: "progress",
    category: "Data Display",
    description: "Show completion progress.",
  },
  {
    name: "Separator",
    slug: "separator",
    category: "Data Display",
    description: "Visual divider between content.",
  },
  {
    name: "Skeleton",
    slug: "skeleton",
    category: "Data Display",
    description: "Placeholder for loading content.",
  },
  {
    name: "Table",
    slug: "table",
    category: "Data Display",
    description: "Structured data in rows and columns.",
  },

  // Feedback
  {
    name: "Alert",
    slug: "alert",
    category: "Feedback",
    description: "Important messages and callouts.",
  },
  {
    name: "Alert Dialog",
    slug: "alert-dialog",
    category: "Feedback",
    description: "Confirmation before destructive actions.",
  },

  // Form
  {
    name: "Checkbox",
    slug: "checkbox",
    category: "Form",
    description: "Toggle a single option on or off.",
  },
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
    name: "Radio Group",
    slug: "radio-group",
    category: "Form",
    description: "Select one option from a set.",
  },
  {
    name: "Select",
    slug: "select",
    category: "Form",
    description: "Pick an option from a dropdown list.",
  },
  {
    name: "Switch",
    slug: "switch",
    category: "Form",
    description: "Toggle between on and off states.",
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
    name: "Popover",
    slug: "popover",
    category: "Overlay",
    description: "Floating content anchored to a trigger.",
  },
  {
    name: "Sheet",
    slug: "sheet",
    category: "Overlay",
    description: "Slide-out panel from screen edge.",
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
  "Data Display",
  "Feedback",
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
