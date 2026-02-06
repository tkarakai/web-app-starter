## Higher Priority

- dark theme with selector
- i18n
- a11y
- next.js bundle analyzer and production optimization
- SEO for landing page
- Add security headers via Next.js middleware or config
  - Content-Security-Policy, X-Frame-Options, and Strict-Transport-Security
- auth: confirm password field
- email provider
  - Resend, SendGrid, or Postmark
- auth: magic link
- auth: email verification flow
- auth: password reset flow
- auth: MFA
- auth: Session Management UI
    - Show users their active sessions across devices and allow them to revoke sessions remotely. Display session metadata like device type and last activity.

## Lower Priority

- Analytics Integration
  - PostHog, Plausible, or Umami
- Error Monitoring Integration
  - Sentry or similar
- API Rate Limiting
- Webhook Support
    - Add webhook infrastructure for external integrations.Include signature verification, retry logic, and example implementations for common services.
    - Webhooks are essential for integrations with payment providers, third-party services, and automation tools. Pre-built infrastructure reduces implementation time.
- Payment System integration
  - Square, ...
- Database seeding
  - Provide seed scripts to populate the database with sample data for development and testing. Include realistic user data, sample content, and relationships.