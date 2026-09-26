# AWS Deployment Runbook

Procedures for hosting web, admin and landing on AWS instead of Vercel. Convex stays on Convex
Cloud; hosting Convex on AWS is out of scope (see
[deployment-architecture-aws.md](./deployment-architecture-aws.md#scope)).

- Architecture and trade-offs: [deployment-architecture-aws.md](./deployment-architecture-aws.md)
- Stack parameters and outputs: [cloudformation-stacks-aws.md](./cloudformation-stacks-aws.md)
- Script reference: [infra/aws/README.md](../../../infra/aws/README.md)

Every step ends with a checkpoint. Don't continue past a checkpoint that fails.

---

## 1. Tools and access

```bash
aws --version          # AWS CLI v2
docker buildx version  # Docker with BuildKit
bun --version
jq --version
git --version
uvx --version          # optional: runs cfn-lint without installing it (or: pipx install cfn-lint)
```

AWS access: an administrator once per environment for `bootstrap.sh` (step 3a); after that,
whoever deploys needs only the deployer policy it creates, plus ACM and Route53 console access for
the certificate and DNS steps.

**Checkpoint 1**: `aws sts get-caller-identity --profile "$AWS_PROFILE"` returns the account
you mean to deploy to.

---

## 2. Rehearse on the local target

The `local` target runs the same templates and scripts against [Floci](https://github.com/floci-io/floci),
with its own Convex backend, entirely in Docker. `bun run dev` isn't needed.

```bash
bun run aws:local:up         # first run also builds the patched Floci image (~3 min)
```

| What | Where |
|---|---|
| web | http://web.app.localhost:8080 |
| admin | http://admin.app.localhost:8080 |
| landing | printed at the end: `http://<id>.cloudfront.localhost.floci.io:4566` |
| Convex (API / HTTP actions) | http://convex.localhost.floci.io:3310 / :3311 |
| Convex function logs (emails show up here) | `infra/aws/local/.state/convex.log` (`bun run aws:local:logs`) |
| Floci console | http://localhost:4566/_floci/ui |

| Command | Does |
|---|---|
| `bun run aws:local:status` | Lists the containers, the commit deployed and these URLs; exits non-zero when the target isn't running |
| `bun run aws:local:check` | Runs the deploy's smoke checks again |
| `bun run aws:local:logs` | Follows the Convex function logs |
| `bun run aws:local:down` | Stops everything and wipes its Convex data; `aws:local:up` starts fresh |

The dev seed accounts exist, as in `bun run dev` (`admin@admin.com`, `user@user.com`; passwords in
`packages/backend/convex/devSeed.ts`). Passkeys work in a normal browser: `*.localhost` counts as a
secure context without HTTPS.

Deploy another commit with `infra/aws/scripts/deploy-manual.sh --env local --sha <commit>`; the
scripts build from commits, never from uncommitted changes. Run the E2E suites against it:

```bash
export E2E_CONVEX_LOG=$PWD/infra/aws/local/.state/convex.log CONVEX_SITE_URL=http://convex.localhost.floci.io:3311
E2E_BASE_URL=http://web.app.localhost:8080 bun run --cwd apps/web test:e2e
E2E_BASE_URL=http://admin.app.localhost:8080 bun run --cwd platform/apps/admin test:e2e
```

`bun run aws:local:up --iam` does the same with IAM enforcement on, deploying as a user that holds
only the deployer policy (step 3a).

What the local target can't show (TLS at the load balancer, DNS, security groups, IAM resource
scoping, Fargate specifics) is listed in the
[architecture doc](./deployment-architecture-aws.md#what-the-local-target-covers).
Section 3f covers verifying those on AWS for as little as possible.

**Checkpoint 2**: `aws:local:up` ends with `Smoke checks passed for env=local`.

---

## 3. One-time setup per environment

### 3a. Bootstrap (administrator, once)

```bash
infra/aws/scripts/bootstrap.sh --env staging --profile "$ADMIN_PROFILE"
infra/aws/scripts/check-deployer-policy.sh --env staging --profile "$ADMIN_PROFILE"
```

`bootstrap.sh` creates the role CloudFormation deploys through and prints the **deployer
policy** ARN. Attach that policy, and nothing else, to whoever deploys: an IAM Identity Center
permission set, a role for CI, or a user. `check-deployer-policy.sh` runs IAM's policy simulator
against the real ARNs: the scripts' actions are allowed, and other stacks, repositories, roles and
direct resource creation are denied. IAM is free, so this costs nothing.

### 3b. Certificates and DNS

1. Request an ACM certificate **in the stack's region** covering the web and admin hosts
   (a wildcard such as `*.staging.example.com` is simplest).
2. If landing gets a custom domain, request a second certificate for it **in us-east-1**
   (CloudFront only uses us-east-1 certificates).
3. Validate both (DNS validation).

Route53 users can set `HostedZoneId` in `network.json` and `landing.json` to have the stacks
create the alias records. Otherwise point the hosts at the ALB (`AlbDnsName` output) and the
CloudFront domain yourself after step 5.

### 3c. Parameter files

Edit `infra/aws/params/<env>/`:

| File | Set |
|---|---|
| `network.json` | `ProjectName`, `WebHost`, `AdminHost`, `AcmCertificateArn`, `HostedZoneId` (optional) |
| `landing.json` | `LandingDomainName` + `AcmCertificateArn` (us-east-1), or leave both empty to use the CloudFront domain |
| `apps.json` | `ConvexUrl` / `ConvexSiteUrl`: the Convex Cloud deployment for this environment (the same one Vercel uses), and sizing |
| `registry.json` | nothing, unless you change image retention |

Keep `ProjectName` identical across the four files. These files hold no secrets.

### 3d. Convex deploy key

`deploy-convex.sh` needs the environment's Convex deploy key in `CONVEX_DEPLOY_KEY`. It's the
same key the GitHub environment secret `CONVEX_DEPLOY_KEY` holds (Convex dashboard → Settings →
Deploy keys). Supply it for the one command without writing it to shell history, for example:

```bash
read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY   # paste, Enter
```

or from your password manager's CLI. Don't put it in a parameter file.

### 3e. Convex environment variables

The Convex deployment is the one Vercel already uses, so `BETTER_AUTH_SECRET`, `RESEND_API_KEY`,
`EMAIL_FROM` and `PASSKEY_RP_ID` are already set (see [deployment-runbook.md](../deployment-runbook.md)).
`deploy-convex.sh` only adds the AWS origins and checks `BETTER_AUTH_SECRET` exists.

If web and admin share a parent domain and should share passkeys, set `PASSKEY_RP_ID` to that
parent domain on the Convex deployment. Changing it invalidates passkeys registered under the
old RP ID.

### 3f. The cheapest real-AWS run

The local target covers most of the path. These need real AWS:

| Needs AWS | Cost | How |
|---|---|---|
| Deployer policy resource scoping | Free | `check-deployer-policy.sh` (3a): IAM only |
| Templates accepted by real CloudFormation | Free | `deploy-manual.sh --dry-run`: change sets are free, nothing is created |
| TLS, ACM, DNS, `__Secure-` cookies, security groups, Fargate, NAT, circuit breaker | ~$0.14/hour while up | A real `staging` run, destroyed afterwards |

A real run needs:

1. **An AWS account.** New accounts get Free Tier credits (check the current terms). Set a
   budget alert (Billing → Budgets, e.g. $10) before deploying anything.
2. **A domain you control**, for the certificate: a subdomain of an existing one is enough
   (`web.sandbox.example.com`, `admin.sandbox.example.com`). ACM certificates are free. Validate by
   adding the CNAME records ACM shows in your current DNS provider; a Route53 hosted zone
   ($0.50/month) is optional.
3. **The staging Convex deployment**: already there for Vercel, with its deploy key.

Then steps 3a to 5 as written, and when you're done:

```bash
infra/aws/scripts/destroy.sh --env staging --profile "$AWS_PROFILE"
```

It empties the landing bucket and ECR repositories and deletes every stack, so nothing keeps
billing (it refuses `production`). While up, the bill is roughly (us-east-1, default sizing):

| Resource | Per hour |
|---|---|
| NAT gateway | $0.045 (+ $0.045/GB) |
| Load balancer | ~$0.03 |
| Two Fargate tasks (ARM, 0.5 vCPU / 1 GB) | ~$0.04 |
| Public IPv4 addresses (ALB, NAT) | ~$0.015 |
| CloudFront, S3, ECR storage, logs | cents per month |

About $0.14/hour, so a two-hour session costs around $0.30, and ~$100/month if left running.

Mixing real and local pieces within one environment isn't worth it. A real ALB can only route
to targets inside its VPC, so it can't front the local containers without a VPN. The split that
works is by concern: the local target for everything above, a short real run for TLS, DNS,
security groups and Fargate.

**Checkpoint 3**: `bun run aws:validate --env staging` passes: no placeholder values, HTTPS on,
certificate set, Convex URLs are `https://`.

---

## 4. Dry run

```bash
infra/aws/scripts/deploy-manual.sh --env staging --profile "$AWS_PROFILE" --dry-run
```

This creates change sets for `network`, `registry` and `landing` without executing them. Review
them in the CloudFormation console. On the first run everything is an `Add`.

**Checkpoint 4**: no change set replaces a resource you didn't expect (`Replacement: True`).

---

## 5. Deploy staging

```bash
export CONVEX_DEPLOY_KEY   # staging key, see 3d
infra/aws/scripts/deploy-manual.sh --env staging --profile "$AWS_PROFILE" --sha <commit>
```

It validates, deploys the infrastructure stacks, builds and pushes images that don't exist yet,
deploys Convex functions and runs migrations, rolls web/admin, publishes landing and runs the
smoke checks. The first run takes longest: the NAT gateway, ALB and CloudFront distribution are
created, and both images are built.

**Checkpoint 5**: the run ends with `Smoke checks passed for env=staging`. Then by hand:

- sign in to web and admin (password, and a passkey if you use them)
- sign out and sign in again, so the auth cookie round trip works over HTTPS
- submit the landing waitlist form (checks the Convex HTTP routes and CORS)
- trigger an email (password reset), so Resend links point at the AWS web host once `--replace-origins` has run

---

## 6. Deploy production

Production runs the images staging tested, copied between registries rather than rebuilt:

```bash
export CONVEX_DEPLOY_KEY   # production key
infra/aws/scripts/deploy-manual.sh --env production --profile "$PROD_PROFILE" \
  --sha <commit staging runs> --promote-from staging --from-profile "$AWS_PROFILE"
```

`promote-images.sh` refuses if staging's images differ from `<commit>`: deploy it to staging
first. landing is rebuilt for production because its URLs are inlined at build time.

**Checkpoint 6**: production smoke checks pass, and the checkpoint 5 checks pass by hand.

---

## 7. Cut over from Vercel

Until now the Convex deployments accept both the Vercel and the AWS origins, and `SITE_URL` still
lists the Vercel web URL first, so emails link to Vercel.

1. Point the public DNS names at AWS (ALB and CloudFront), if they still point at Vercel.
2. Make AWS the only origin Convex accepts:

   ```bash
   infra/aws/scripts/deploy-convex.sh --env production --profile "$PROD_PROFILE" --skip-deploy --replace-origins
   ```

3. Keep the Vercel projects until the AWS deployment has been stable for a while, then remove them
   and disable the Vercel CD workflows.

**Checkpoint 7**: sign-in, email links and the landing waitlist work on the public names, and
the Vercel URLs are no longer accepted by Convex.

---

## 8. Rollback

```bash
export CONVEX_DEPLOY_KEY
infra/aws/scripts/rollback-manual.sh --env staging --profile "$AWS_PROFILE" --sha <earlier commit>
```

web/admin go back to that commit's images, normally still in ECR (rebuilt only if the lifecycle
policy expired them). Convex functions and landing are redeployed from the commit. A rollback
across a schema change needs the procedure in [convex-migrations.md](../convex-migrations.md).

A web/admin deploy that never becomes healthy is rolled back by the ECS circuit breaker without
any action; `deploy-app-services.sh` then fails and the stack returns to the previous tags.

**Checkpoint 8**: smoke checks pass, and `aws cloudformation describe-stacks --stack-name
<project>-<env>-apps` shows the rolled-back tags in `WebImageTag` / `AdminImageTag`.

---

## 9. Operating

| Task | Command |
|---|---|
| App logs | `aws logs tail /aws/ecs/<project>-<env>-web --follow` (and `-admin`) |
| Service state | `aws ecs describe-services --cluster <project>-<env> --services <project>-<env>-web` |
| What is deployed | `aws cloudformation describe-stacks --stack-name <project>-<env>-apps --query 'Stacks[0].Outputs'` |
| Scale | change `WebDesiredCount` / sizing in `apps.json`, then `deploy-app-services.sh --sha <deployed commit>` |
| Infra change | edit a template or params, `deploy-manual.sh --dry-run`, review, then `deploy-stacks.sh` |
| Deploy history | `git tag -l 'deploy/aws/*'` |

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `validate.sh`: placeholder values | Replace every `example.com` / `REPLACE` value in the env's params |
| Stack stuck in `ROLLBACK_COMPLETE` | A first create failed. The scripts delete such a stack and retry; read the stack events for the cause |
| `No web image … in the registry` | Run `build-push-images.sh` for the commit, or deploy through `deploy-manual.sh` |
| Tasks start and stop, deploy rolls back | `aws logs tail` the service. Usually `CONVEX_URL` / `CONVEX_SITE_URL` in `apps.json` is wrong |
| `exec format error` in task logs | Image architecture ≠ `CpuArchitecture`; rebuild with `build-push-images.sh --force` |
| Sign-in fails with `Invalid origin` | The Convex deployment doesn't allow the AWS origin: run `deploy-convex.sh --skip-deploy` |
| Landing `/en/` returns 404 | A page was uploaded without its directory keys; rerun `deploy-landing.sh` |
| Local: `The local Convex backend is not reachable` | `docker compose -p my-app-aws-local logs convex`; `aws:local:down` then `aws:local:up` resets it |
| Local: signed in, then bounced back to sign-in | The Floci image isn't the patched one (only the last `Set-Cookie` arrives); rerun `infra/aws/local/build-floci.sh --force` |
