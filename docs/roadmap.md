## Now

let's establish the process of how to deploy the apps (landing, web, admin), once they pass all checks in CI. All three must pass built from the same git state. The only way I want this to happen is using the build artifacts produced by a passing CI build, stored on github. I do NOT want deployments directly from the git repo, only from static, verified, secure, already pre-built artifacts. First, please let me know what is the best way to design this flow, what kind of guardrails/gates we can include in the workflow, where would we store the artifacts (I think github packages is an option?), how we would secure those artifacts (checksum, sha, signing them, what else is a good practice?) how to take those artifacts for deployment, how to set up secrets, env, etc for them, what service providers are available (vercel, claoudflare are the most obvious first choices for me, with their free tier service), how to deploy to convex, how to migrate data if there is a schema change. Also, I am interested in setting up CI, STAGING and finally the PROD environemnts, so lets account for that too. Auditablity of the builds is important not just for troubleshooting purposes, but to prove the circumstances of the build. Auditability of deployment is also important, to be able to prove what is exactly deployed. Phew. All these are a big topic, let's think it through and consider security, auditablity and reliable devops processes, with as much automation as possible to avoid human mistakes. 

## Higher Priority
- where t preserve build artifacts in github? both logs (the same as the content of .act-artifacts, but on github), as well as deployable artifacts that can go to vercel
- i18n
- a11y
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