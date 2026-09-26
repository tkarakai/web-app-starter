# AWS Deployment Architecture (replacing Vercel)

This document describes how to host the web, admin and landing apps on AWS instead of
Vercel. It is a manual, CLI-driven alternative to the Vercel pipeline in
[deployment-architecture.md](../deployment-architecture.md); it does not change the GitHub
workflows.

- Step-by-step procedures: [deployment-runbook-aws.md](./deployment-runbook-aws.md)
- Stack parameters and outputs: [cloudformation-stacks-aws.md](./cloudformation-stacks-aws.md)
- Scripts and local emulation: [infra/aws/README.md](../../../infra/aws/README.md)

## Scope

**In scope: replacing Vercel.** The three apps Vercel hosts today move to AWS:

| App | Vercel today | AWS |
|---|---|---|
| `web` | Vercel project, serverless | ECS Fargate service behind an Application Load Balancer |
| `admin` | Vercel project, serverless | ECS Fargate service behind the same ALB |
| `landing` | Vercel project, static export | S3 bucket behind CloudFront |

**Out of scope: hosting Convex on AWS.** Convex stays exactly as it is today: Convex Cloud
for staging and production, the local `convex dev` deployment for development. Functions
are deployed with `convex deploy` and a deploy key, as `.github/actions/deploy-convex`
does. No database, Convex backend, file-storage bucket or Convex dashboard runs on AWS.

Also out of scope: `landing-static` (not deployed by the Vercel pipeline either), `demo`
and `storybook`, and replacing the GitHub CD workflows. The AWS path is operated from a
terminal.

## Topology

```
                         ┌──────────────────────── AWS account (per environment) ─────────────────────────┐
                         │                                                                                  │
 browser ── HTTPS ──▶ ALB (host rules) ──▶ web   ECS Fargate (private subnets, ARM64) ──┐                   │
                         │           └──────▶ admin ECS Fargate                          ├── NAT ──▶ Convex Cloud
                         │                                                                │   (convex.cloud / .site)
 browser ── HTTPS ──▶ CloudFront ──(OAC)──▶ S3 bucket: landing static export              │                   │
                         │                                                                                  │
                         │   ECR: <project>-<env>-web / -admin (immutable, SHA-tagged images)               │
                         └──────────────────────────────────────────────────────────────────────────────────┘
 browser ───────────────────────────────────────────────────────────────────────────────▶ Convex Cloud
```

- The browser talks to Convex Cloud directly, as it does on Vercel.
- web/admin call Convex server-side (auth token exchange, server queries) through the NAT gateway.
- The ALB routes by `Host` header: `WebHost` → web, `AdminHost` → admin. Plain HTTP only redirects to HTTPS.

## Stacks

| Stack | Template | Contents | Deployed by |
|---|---|---|---|
| `bootstrap` | `bootstrap.yaml` | The role CloudFormation assumes to create everything else, and the least-privilege **deployer policy** for whoever runs the scripts | `bootstrap.sh`, once, by an administrator |
| `network` | `network.yaml` | VPC, 2 public + 2 private subnets, NAT, ALB, listeners, host rules, target groups, security groups, optional Route53 records. **Exports the public URLs.** | `deploy-stacks.sh` |
| `registry` | `registry.yaml` | ECR repositories for web and admin (immutable tags, lifecycle policy) | `deploy-stacks.sh` |
| `landing` | `landing.yaml` | S3 bucket (private, OAC), CloudFront distribution, optional Route53 record. **Exports `LandingUrl`.** | `deploy-stacks.sh` |
| `apps` | `apps.yaml` | ECS cluster, task definitions, web and admin services | `deploy-app-services.sh` (needs image tags) |

A host name is configured once, in `network.json` or `landing.json`. Every other stack and
script reads the URLs from stack outputs.

Once `bootstrap` exists, every stack is deployed with `--role-arn` (the execution role), so the
person or CI job deploying holds only the deployer policy: CloudFormation on this project's
stacks, passing that one role, pushing to this project's ECR repositories, writing the landing
bucket and invalidating CloudFront. It can't create a VPC, a role or a service directly.

## Build once, promote

web and admin read their environment at request time, not at build time
([promotion](../deployment-architecture.md#promotion-build-once-deploy-twice)). The AWS path relies on that:

- One image per app per commit, tagged with the commit SHA, built from `git archive` of that
  commit (never the working tree), for the architecture in `apps.json` (`ARM64` by default).
- The image build runs `scripts/check-env-leak.sh` against placeholder Convex URLs, so an
  image that inlined environment identity fails to build.
- The same image runs in staging and production. Promoting to production means deploying the
  tag staging runs.
- An app whose image inputs (its directory, `packages/`, lockfile, root config,
  `infra/aws/docker/`) are unchanged since the deployed tag keeps that tag and is not rebuilt.
  This is the AWS counterpart of the Vercel pipeline's content-addressed artifacts.

landing is a static export, so its URLs are inlined at build time and it is rebuilt per
environment, exactly as on Vercel.

## Runtime configuration

web and admin tasks (`apps.yaml`):

| Variable | Source | Apps |
|---|---|---|
| `CONVEX_URL`, `CONVEX_SITE_URL` | `apps.json` (Convex Cloud deployment URLs) | web, admin |
| `LANDING_URL` | `landing` stack export | web |
| `APP_ENVIRONMENT` | `apps.json` (`staging`; empty in production) | web, admin |
| `TRUSTED_PROXY_COUNT` | `apps.json` (`1`: the ALB) | web, admin |
| `PORT`, `HOSTNAME` | fixed (`3000`, `0.0.0.0`) | web, admin |

There is no `SITE_URL` for the apps: they derive their origin from the `Host` header, which the
ALB forwards unchanged (`routing.http.preserve_host_header.enabled`).

landing build (`deploy-landing.sh`): `NEXT_PUBLIC_SITE_URL` (landing URL), `NEXT_PUBLIC_WEB_APP_URL`
(web URL), `NEXT_PUBLIC_CONVEX_SITE_URL`. The optional `NEXT_PUBLIC_BOOK_DEMO_URL` and
`NEXT_PUBLIC_CONTACT_URL` (links on the backend-unreachable card) are taken from the environment
`deploy-landing.sh` runs in, as Vercel takes them from the project settings.

Convex deployment (`deploy-convex.sh`): the AWS web, admin and landing origins are added to
`SITE_URL`, `ADMIN_SITE_URL` and `LANDING_URL`, the comma-separated allow-lists Better Auth and
the HTTP routes check. They are added, not replaced, so one Convex deployment can serve Vercel and
AWS side by side during a migration; `--replace-origins` makes AWS the only origin at cutover.
Everything else on the Convex deployment (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`,
`PASSKEY_RP_ID`) is managed as it is today.

### Client IPs and rate limiting

The edge rate limiter keys on the client IP from `X-Forwarded-For`. Vercel overwrites that
header; an ALB appends to whatever the client sent, so the first entry is attacker-controlled.
`TRUSTED_PROXY_COUNT=1` makes `getClientIp` take the entry the ALB appended. Unset (Vercel) keeps
the old behavior. The limiter's counters are per task, as they are per instance on Vercel.

### What the apps do to run outside Vercel

Each of these keeps Vercel's behavior unchanged:

| Change | Why |
|---|---|
| `output: "standalone"` when `NEXT_OUTPUT=standalone` (web, admin) | A self-contained server for the container image. Vercel builds leave it unset |
| `getClientIp` honours `TRUSTED_PROXY_COUNT` | An ALB appends to `X-Forwarded-For`; the first entry is client-controlled (see above) |
| CSP `connect-src` always includes the runtime `CONVEX_URL` / `CONVEX_SITE_URL` origins, next to `*.convex.cloud` | So a Convex custom domain or the local target's Convex backend is reachable from a production build |
| `/api/auth/clear-session` redirects with a relative `Location` | In a standalone server a route handler's `request.url` carries the bind address (`0.0.0.0:3000`), not the public host |
| Playwright `E2E_BASE_URL`, `E2E_CONVEX_LOG`, cookie domain from `baseURL` | Run the E2E suites against any deployed target, not only `bun run dev` |

## Deployment targets

| Target | Where | Convex | Cost | Use |
|---|---|---|---|---|
| `local` | Floci on your machine (`infra/aws/local`) | Its own Convex backend container | Free | Rehearse every change: templates, scripts, images, full E2E suite |
| `staging` | A real AWS account | The staging Convex Cloud deployment | ~$0.14/hour while up | The first real run; can be brought up for a session and destroyed |
| `production` | A real AWS account (ideally a separate one) | The production Convex Cloud deployment | Always on | Promoted from staging |

The same templates and scripts serve all three. `--env` picks the parameter files, and `local`
also points the AWS CLI at Floci.

## Deployment flow

`deploy-manual.sh` follows the order of `cd-staging.yml`:

1. `validate.sh`: parameter files match the templates; no placeholders, HTTPS and a certificate
   for staging/production; `cfn-lint`
2. `deploy-stacks.sh`: network, registry, landing
3. `build-push-images.sh`: build and push images that don't exist yet
4. `deploy-convex.sh`: `convex deploy`, migrations, origin allow-lists
5. `deploy-app-services.sh`: apps stack with the new image tags; ECS rolls the services and
   the circuit breaker rolls back a deployment that doesn't become healthy
6. `deploy-landing.sh`: build, upload to S3, invalidate CloudFront
7. `smoke-check.sh`: Convex `/version`, web and admin sign-in pages (and that they carry the
   runtime Convex URL), landing root and a locale page

Convex goes first so new app code never runs against old functions.

Rollback (`rollback-manual.sh --sha <commit>`) redeploys the images already in ECR for that
commit (rebuilding only if the lifecycle policy expired them), redeploys Convex functions and
landing from the commit, and smoke-checks. As with `cd-rollback.yml`, schema changes are not
undone; see [convex-migrations.md](../convex-migrations.md).

Deploys of commits on `origin/main` are recorded as `deploy/aws/<env>/<timestamp>/<sha>` tags.

## The local target

`bun run aws:local:up` starts [Floci](https://github.com/floci-io/floci) and a Convex backend in
Docker and deploys a commit with the same scripts as AWS. Nothing else is needed; in particular not
`bun run dev`, whose Convex deployment it leaves alone.

### Addressing

| Name | Resolves to | Why |
|---|---|---|
| `web.app.localhost:8080`, `admin.app.localhost:8080` | Loopback, in every browser | Browsers treat `*.localhost` as a **secure context** over plain HTTP, so passkeys, `crypto.subtle` and the rest behave as on HTTPS. Only the browser uses these names |
| `convex.localhost.floci.io:3310` / `:3311` | `127.0.0.1` via public DNS on the host; Floci inside its containers | One URL that works from the browser **and** from the web/admin tasks, as `CONVEX_URL` must |
| `{id}.cloudfront.localhost.floci.io:4566` | Same as above | Floci names distributions with this suffix (compose setting) |

`web.app.localhost` and `admin.app.localhost` share passkeys through `PASSKEY_RP_ID=app.localhost`,
exactly as `web.<domain>` and `admin.<domain>` do with `PASSKEY_RP_ID=<domain>` on AWS. Chrome
rejects `localhost` itself as an RP ID for a subdomain, which is why the hosts sit one level down.

### Its own Convex deployment

The local target runs a Convex backend container (`infra/aws/local/compose.yaml`) and treats it
the way staging treats its Convex Cloud deployment. `deploy-convex.sh --env local` deploys the
functions, runs migrations, sets the origins to the local hosts and applies
`infra/aws/local/convex.env` (`PASSKEY_RP_ID`, `DEV_SEED_ENABLED`), generates a
`BETTER_AUTH_SECRET` and applies the dev seed. Sharing the `bun run dev` deployment doesn't work:
the passkey RP ID derives from its first `SITE_URL` (`localhost`), and changing that breaks dev.

The backend shares Floci's network namespace because Convex calls its own public URL (it fetches
the auth JWKS from `CONVEX_SITE_URL`). Function logs are streamed to
`infra/aws/local/.state/convex.log`, like `.convex-dev.log` in dev, which is where the E2E suite
reads auth emails from.

### Running the E2E suites against a target

`E2E_BASE_URL` points Playwright at a deployed app instead of starting a dev server:

```bash
E2E_BASE_URL=http://web.app.localhost:8080 \
CONVEX_SITE_URL=http://convex.localhost.floci.io:3311 \
E2E_CONVEX_LOG=$PWD/infra/aws/local/.state/convex.log \
  bun run --cwd apps/web test:e2e
```

Add `--workers=1`: parallel workers share the seed user's sign-in rate limit, against a
deployed target as against `bun run dev`. The admin and passkey suites pass in full; a web test
that fails here fails against `bun run dev` too.

### IAM

`local-up.sh --iam` enables Floci's IAM enforcement, bootstraps as the account administrator and
runs the whole deploy as a user holding only the deployer policy. Floci evaluates CloudFormation,
ECR, CloudFront and IAM actions against resource `*` (it builds resource ARNs only for S3,
Lambda, SQS, SNS, DynamoDB, Kinesis, Secrets Manager, SSM and KMS). So this proves the policy
grants every **action** the scripts use. `check-deployer-policy.sh` proves the **resource
scoping** on a real account with IAM's policy simulator, for free (Floci doesn't implement the
simulator).

### What the local target covers

| Capability | Local target |
|---|---|
| CloudFormation stacks, change sets, exports, execution role | ✅ Same templates (see quirks below) |
| ECS services on Fargate-shaped task definitions, registered with the ALB | ✅ Real containers |
| ALB host routing, preserved `Host`, `X-Forwarded-*` | ✅ With the local Floci patch (below) |
| ECR push/pull, immutable tags, promotion between registries | ✅ |
| S3 + CloudFront static hosting, directory URLs, 404 page, invalidations | ✅ |
| Secure context, passkeys (registration, sign-in, shared RP ID) | ✅ `*.localhost`; passkey E2E suite passes |
| Deployer policy: action coverage | ✅ `--iam` |
| Deployer policy: resource scoping | ❌ Floci uses `*`; use `check-deployer-policy.sh` (free, real IAM) |
| TLS at the ALB, ACM validation, HTTP→HTTPS redirect, `__Secure-` cookies | ❌ Floci's HTTPS listeners serve plain HTTP |
| DNS (Route53 records) | ❌ Stored, never served |
| Security groups, execution role's own permissions, bucket policies | ❌ Not enforced |
| Fargate specifics (image pull through NAT, CPU architecture, circuit breaker timing) | ❌ Tasks run on the host's architecture |
| Convex Cloud, Resend | ❌ Not AWS; the local target uses its own Convex backend and logs emails |

### Floci patches and quirks

`infra/aws/local/build-floci.sh` builds the pinned Floci release plus the patches in
`infra/aws/local/floci-patches/`, until they are released upstream:

- **0001:** the ALB data plane kept only the last value of a repeated header, so of Better Auth's
  two `Set-Cookie` headers the session cookie never reached the browser. It also added no
  `X-Forwarded-For/-Proto/-Port`, which an ALB always sends.

The templates are written around Floci limitations, and remain valid CloudFormation:

- `AWS::NoValue` inside a list isn't dropped, so the HTTPS ingress rule is a separate
  `AWS::EC2::SecurityGroupIngress` resource.
- An `!If` over a whole list-valued property (CloudFront `Aliases`) and `${Resource.Attr}` inside
  `!Sub` within `!If` aren't resolved, so the local branch avoids them.
- CloudFront aliases are applied on create but not on update.

## Security baseline

- web/admin tasks run in private subnets, reachable only from the ALB security group.
- HTTPS is mandatory outside `local` (`validate.sh` refuses otherwise): TLS 1.2+/1.3 policy, HTTP → HTTPS redirect.
- The landing bucket is private and readable only by its CloudFront distribution (OAC).
- ECR tags are immutable and images are scanned on push.
- Containers run as the unprivileged `node` user.
- The task role has no permissions. The apps call no AWS APIs.
- No secrets live in AWS for this path. The Convex deploy key is supplied to `deploy-convex.sh`
  at run time (see the runbook), never committed or stored in parameter files.

## Trade-offs

- **Manual operation.** The scripts are the pipeline; no GitHub workflow runs them.
- **Always-on cost.** Unlike Vercel, Fargate tasks, the ALB and the NAT gateway bill while idle:
  about $0.14/hour (~$100/month) for the default sizing in us-east-1. `destroy.sh` removes a
  non-production environment completely between test sessions.
- **One region.** CloudFront covers landing; web/admin are served from the stack's region.
- **Per-task rate limiting.** As on Vercel, limits are per instance, not global.
