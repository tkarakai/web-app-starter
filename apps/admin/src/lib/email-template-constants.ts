/** Shape of a stored email template (mirrors backend EmailTemplate type). */
export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

/** Template variable metadata for the admin UI. */
export const TEMPLATE_VARIABLES = [
  {
    name: "invitation_link",
    description: "The unique signup URL for this invitation",
  },
  {
    name: "recipient_name",
    description: 'Display name (or "there" if unknown)',
  },
  {
    name: "expiry_days",
    description: "Days until the invitation expires",
  },
] as const;

/** Sample values used when rendering previews in the admin UI. */
const SAMPLE_VALUES: Record<string, string> = {
  invitation_link: "https://example.com/signup-with-invitation?token=abc123",
  recipient_name: "Alex",
  expiry_days: "7",
};

/** Replace `{{variable}}` placeholders with sample values for preview. */
export function renderPreview(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return SAMPLE_VALUES[key] ?? match;
  });
}
