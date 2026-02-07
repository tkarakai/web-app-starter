## Now



## Higher Priority
- versioning? all apps version synchronized? yes! Version info visible in app?
- About page, T&C, Privacy page templates
- framework level (app independent, but assuming convex and better-auth as foundational) security tests. I am afraid of issues that are present in Google's Firebase where users share tables and the default access control does not address row based access...
- is packages/backend/convex/meta.ts a public health check endpoint? healthcheck?
- GitHub built-in: Email notifications for failed workflows
- uptime page? it can also include deployment status (poll github status API)?
- i18n framework
- a11y testing and guidelines
- next.js bundle analyzer and production optimization
- SEO for landing page
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
- framework for role based access control for both users and admins
