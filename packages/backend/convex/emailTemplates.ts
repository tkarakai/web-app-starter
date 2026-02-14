/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build the invitation email HTML body. */
export function buildInvitationEmailHtml(
  name: string,
  signupUrl: string,
  expiryDays: number
): string {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(signupUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 20px; max-width: 560px; margin: 0 auto; color: #1a1a1a; line-height: 1.6;">
  <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">You&#39;re invited!</h1>
  <p>Hi ${safeName},</p>
  <p>You&#39;ve been invited to join. Click the button below to create your account:</p>
  <a href="${safeUrl}"
     style="display: inline-block; padding: 12px 24px; background: #18181b; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; margin: 16px 0;">
    Create your account
  </a>
  <p style="color: #666; font-size: 14px;">
    This invitation expires in ${expiryDays} day${expiryDays === 1 ? "" : "s"}.
    If you did not request this, you can safely ignore this email.
  </p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
  <p style="color: #999; font-size: 12px;">
    If the button doesn&#39;t work, copy and paste this URL into your browser:<br>
    <span style="word-break: break-all;">${safeUrl}</span>
  </p>
</body>
</html>`;
}
