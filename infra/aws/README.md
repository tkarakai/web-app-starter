# AWS hosting (replaces Vercel)

CloudFormation stacks and operator scripts that host `web`, `admin` and `landing` on AWS instead
of Vercel. **Convex is not hosted here:** it stays on Convex Cloud, deployed with its deploy key
exactly as the Vercel pipeline does. The `local` target runs its own Convex backend container.

Docs: [architecture](../../docs/aws/deployment-architecture-aws.md) ·
[runbook](../../docs/aws/deployment-runbook-aws.md) ·
[stack contracts](../../docs/aws/cloudformation-stacks-aws.md)

## Layout

```
cloudformation/   bootstrap, network, registry, landing, apps
params/<env>/     non-secret parameters per environment: local, staging, production
docker/           next-app.Dockerfile (web and admin, standalone output)
scripts/          operator scripts (below)
local/            the local target: compose.yaml (Floci + a Convex backend), local-up.sh,
                  local-down.sh, local-status.sh, build-floci.sh + floci-patches/, convex.env
```

## Deployment targets

`--env local` targets a local [Floci](https://github.com/floci-io/floci) emulator with its own
Convex backend (everything in Docker); `staging` and `production` target real AWS accounts through
`--profile` or the ambient credentials. The templates and scripts are the same for all three.
`local` only switches the endpoint and uses `params/local/`.

## Scripts

All scripts take `--env <local|staging|production>` and `--profile <aws-profile>`. `--sha`
defaults to `HEAD`. Scripts build and deploy from `git archive` of a commit, never from the
working tree.

| Script | Does |
|---|---|
| `bootstrap.sh` | Once per environment, as an administrator: the CloudFormation execution role and the deployer policy |
| `check-deployer-policy.sh` | Verify the deployer policy with IAM's policy simulator against real ARNs (free; AWS only) |
| `validate.sh [--skip-aws]` | Params match templates; no placeholders; HTTPS + certificate outside `local`; `cfn-lint` (via `uvx` if not installed) |
| `deploy-stacks.sh [--no-execute-changeset]` | Deploy `network`, `registry`, `landing` |
| `build-push-images.sh [--sha] [--app web\|admin] [--force]` | Build and push images that aren't in ECR yet; skip apps whose inputs are unchanged since the deployed image |
| `promote-images.sh --from <env> [--from-profile]` | Copy the images `<env>` runs into this environment's registry |
| `deploy-convex.sh [--sha] [--replace-origins] [--skip-deploy]` | `convex deploy` + migrations (needs `CONVEX_DEPLOY_KEY`; `local` uses the local backend's admin key), then add the AWS origins to Convex's allow-lists |
| `deploy-app-services.sh [--sha] [--exact \| --web-tag --admin-tag]` | Deploy the `apps` stack with image tags; ECS rolls the services |
| `deploy-landing.sh [--sha]` | Build the static export for this environment, upload to S3, invalidate CloudFront |
| `smoke-check.sh` | Convex, web, admin and landing answer; web/admin carry the runtime Convex URL |
| `deploy-manual.sh [--sha] [--force] [--dry-run] [--replace-origins] [--promote-from <env>]` | All of the above, in pipeline order, and a `deploy/aws/...` tag for commits on `origin/main` |
| `rollback-manual.sh --sha <commit>` | Redeploy a commit's images, Convex functions and landing |
| `destroy.sh [--yes] [--keep-bootstrap]` | Delete an environment completely (refuses production) |

## Quick start

```bash
# Local target (needs only Docker)
bun run aws:local:up            # add --iam to deploy as the least-privilege deployer
bun run aws:local:status        # containers, deployed commit, URLs to open
bun run aws:local:check         # smoke checks: Convex, web, admin and landing answer
bun run aws:local:logs          # follow Convex function logs (auth emails show up here)
bun run aws:local:down          # stop everything and wipe its Convex data

# Staging (first time: infra/aws/scripts/bootstrap.sh --env staging, as an administrator)
bun run aws:validate --env staging
CONVEX_DEPLOY_KEY=… infra/aws/scripts/deploy-manual.sh --env staging --profile my-staging --sha <commit>

# Production: promote what staging tested
CONVEX_DEPLOY_KEY=… infra/aws/scripts/deploy-manual.sh --env production --profile my-prod \
  --sha <commit> --promote-from staging --from-profile my-staging
```

See the [runbook](../../docs/aws/deployment-runbook-aws.md) for first-time setup (certificates,
DNS, parameters) and for passing the deploy key without leaving it in shell history.
