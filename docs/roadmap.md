## Now

## Before going live
- [X] About page, T&C, Privacy page templates
- [X] API Rate Limiting
- [X] Admin app with user management with banning
- [ ] Waitlist for early preview product release
    - [ ] no signup page, only with valid token
    - [ ] convex db driven, admin app configurable to tun on/off waitlist feature, allow waitlist sign up and allow batches of people in with welcome email (containing a single-use token link leading to the protected signup page - only with invitation token)
- [ ] Deploy to Convex/Vercel


## Higher Priority (after first deploy)
- [X] i18n framework, RTL and SEO included
- [ ] Announcement bar, to announce early release, public beta, stable release, etc.
    - [ ] call to action button
    - [ ] "learn more" info modal with any html? -- optional
    - [ ] all configurable in admin dashboard
- [ ]audit trail (as part of the admin dashboard)
- [ ] web app graceful offline detection and handling (web and admin)




- versioning? all apps version synchronized? yes! Version info visible in app?
- framework level (app independent, but assuming convex and better-auth as foundational) security tests. I am afraid of issues that are present in Google's Firebase where users share tables and the default access control does not address row based access...
- healthcheck: is packages/backend/convex/meta.ts a public health check endpoint? healthcheck?
- GitHub built-in: Email notifications for failed workflows
- uptime page? it can also include deployment status (poll github status API)?
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
- customer feedback form that feeds into the admin app. Issue tracking, really.

- Develop a strategy for Agenitic AI development. How suitable is this project for Agenitic AI to autonomously develop, test (unit and integration, plus UI testing)? What can be done to make it more suitable? Please create a comprehensive document of what is already possible ans what future work is needed. Please research the best practices for Agenitic AI development before you start.

## Lower Priority

- Analytics Integration
  - PostHog, Plausible, or Umami
- Error Monitoring Integration
  - Sentry or similar
- Webhook Support
    - Add webhook infrastructure for external integrations.Include signature verification, retry logic, and example implementations for common services.
    - Webhooks are essential for integrations with payment providers, third-party services, and automation tools. Pre-built infrastructure reduces implementation time.
- Payment System integration
  - Stripe, Square?, ...
- Database seeding
  - Provide seed scripts to populate the database with sample data for development and testing. Include realistic user data, sample content, and relationships.
- better-auth corporate 