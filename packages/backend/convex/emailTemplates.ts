// ---------------------------------------------------------------------------
// Email template types, defaults, and rendering
// ---------------------------------------------------------------------------

/** Shape of a stored email template (subject + HTML + plain text). */
export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

/** Variables available for substitution in email templates. */
export type TemplateVariables = {
  invitation_link: string;
  recipient_name: string;
  expiry_days: string;
};

/** Metadata about each template variable (for admin UI reference). */
export const TEMPLATE_VARIABLES: {
  name: keyof TemplateVariables;
  description: string;
}[] = [
  {
    name: "invitation_link",
    description: "The unique signup URL for this invitation",
  },
  {
    name: "recipient_name",
    description: "The recipient's display name (or \"there\" if unknown)",
  },
  {
    name: "expiry_days",
    description: "Number of days until the invitation expires",
  },
];

/** Escape HTML special characters to prevent XSS in email templates. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Default invitation email template
// ---------------------------------------------------------------------------

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "You're invited — let's get you set up",
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header accent -->
          <tr>
            <td style="height: 4px; background: linear-gradient(135deg, #18181b 0%, #3f3f46 100%);"></td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px 36px 32px;">
              <h1 style="margin: 0 0 24px; font-size: 22px; font-weight: 700; color: #18181b; line-height: 1.3;">
                You're invited!
              </h1>
              <p style="margin: 0 0 16px; font-size: 15px; color: #3f3f46; line-height: 1.6;">
                Hi {{recipient_name}},
              </p>
              <p style="margin: 0 0 28px; font-size: 15px; color: #3f3f46; line-height: 1.6;">
                We're excited to have you on board. Click the button below to create your account and get started.
              </p>
              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 28px;">
                <tr>
                  <td style="border-radius: 8px; background-color: #18181b;">
                    <a href="{{invitation_link}}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 13px; color: #71717a; line-height: 1.5;">
                This invitation expires in {{expiry_days}} days. If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding: 0 36px;">
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 0;">
            </td>
          </tr>
          <!-- Fallback URL -->
          <tr>
            <td style="padding: 20px 36px 32px;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa; line-height: 1.5;">
                If the button doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin: 6px 0 0; font-size: 12px; color: #a1a1aa; line-height: 1.5; word-break: break-all;">
                {{invitation_link}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  text: `You're invited!

Hi {{recipient_name}},

We're excited to have you on board. Visit the link below to create your account and get started:

{{invitation_link}}

This invitation expires in {{expiry_days}} days. If you didn't request this, you can safely ignore this email.`,
};

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Replace `{{variable_name}}` placeholders with actual values.
 * Unknown variables are left as-is.
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in variables) {
      return variables[key as keyof TemplateVariables];
    }
    return match;
  });
}

/**
 * Render all three fields of an email template.
 * HTML-escapes variable values for subject/html; leaves them raw for text.
 */
export function renderEmailTemplate(
  template: EmailTemplate,
  variables: TemplateVariables
): EmailTemplate {
  const escaped = Object.fromEntries(
    Object.entries(variables).map(([k, v]) => [k, escapeHtml(v)])
  ) as TemplateVariables;
  return {
    subject: renderTemplate(template.subject, escaped),
    html: renderTemplate(template.html, escaped),
    text: renderTemplate(template.text, variables),
  };
}