import {
  renderTemplate,
  type TemplateVariables,
} from "@repo/backend";

// Re-export for convenience
export { TEMPLATE_VARIABLES } from "@repo/backend";
export type { EmailTemplate } from "@repo/backend";

/** Sample values used when rendering previews in the admin UI. */
const SAMPLE_VALUES: TemplateVariables = {
  invitation_link: "https://example.com/signup-with-invitation?token=abc123",
  recipient_name: "Alex",
  expiry_days: "7",
};

/** Replace `{{variable}}` placeholders with sample values for preview. */
export function renderPreview(template: string): string {
  return renderTemplate(template, SAMPLE_VALUES);
}
