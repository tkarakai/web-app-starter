---
name: platform-deploy-setup
description: Set up or resume this app's Vercel, Convex and GitHub deployment configuration with deploy:setup. Use for first deployment or incomplete infrastructure setup; use ops for ordinary deploys of a configured app.
---

# Set up deployment

Read `platform/docs/deploy-setup.md`. Begin with `bun run deploy:setup --check`; its JSON
reports deployment setup only. Report unavailable provider checks separately from missing
configuration. Never interpret secret-name presence as proof that a stored key works.

The wizard is `bun run deploy:setup` in the user's interactive terminal. Accounts, billing,
DNS access, email-domain verification and selecting a production reviewer need the owner.
Surface those early with the links in the guide. Use `ops auth login github|vercel|convex`
for official CLI login. Credentials are entered at hidden local prompts, never in chat,
command arguments, repository files or screenshots. Do not read provider credential files.

Once provisioning is authorized, resume the same `.deploy-setup.json` and its existing project
mappings. This file contains public identifiers only. Do not create replacement projects to
work around a failed check. The wizard verifies root directories and presets; a static-only
landing uses distinct `landing-static` projects with Other preset/output `out`. Primary landing
wins when both are installed. Don't alter platform files to configure an app.

Read each failure and correct its named provider setting. Existing protection rules and backend
secrets must survive setup. Providers may require a paid plan for protection; report the actual
provider error and available setup instructions rather than marking it complete.

`bun run deploy:setup --prove` resumes the saved staging request. Inspect a failed run through
`ops` before requesting another. Never dispatch repeatedly while waiting for evidence. Completion
means the staging workflow and serving verification passed; a successful provisioning API call
or workflow dispatch alone is not a deployment. Production deployment is a separate operation.

Only unconfigured automatic pushes skip staging. Partial credentials, including interrupted setup,
and explicit manual requests fail visibly; configured apps require no setup marker. Convex env
commands run from `packages/backend`. Branch inspection must retain all installed-app required
checks. Public state uses unique atomic temporary writes so abandoned files do not block resume.

Saved proof is bound to the selected topology and staging mappings. Recheck actual serving,
including when a saved workflow succeeded. Changed mappings or legacy evidence require a new
explicit authorization at the wizard’s local prompt; never silently redispatch. A declined prompt
preserves the previous request. Deterministic provider fixtures are simulated evidence, not live
cloud provisioning or deployment verification.
