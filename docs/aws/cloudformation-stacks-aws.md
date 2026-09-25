# AWS CloudFormation Stacks

Parameter and output contracts for the stacks under `infra/aws/cloudformation`. For how they fit
together, see [deployment-architecture-aws.md](./deployment-architecture-aws.md). Convex is not
hosted on AWS, so no stack contains a database, Convex backend or Convex storage.

## Naming and order

Stack names are `<ProjectName>-<Environment>-<stack>`; `ProjectName` comes from
`params/<env>/network.json`. `Environment` is `local`, `staging` or `production`.

```
bootstrap ──▶ (execution role for all of these)
network ─┐
registry ├──▶ apps
landing ─┘
```

`bootstrap.sh` deploys `bootstrap` once, as an administrator. `deploy-stacks.sh` deploys
`network`, `registry`, `landing` in that order, through the bootstrap execution role when it
exists. `apps` imports from all
three and is deployed by `deploy-app-services.sh`, which supplies the image tags. Every
`aws cloudformation deploy` tags the stack `Project=<ProjectName>` and `Environment=<env>`.

Parameter files (`infra/aws/params/<env>/<stack>.json`) hold non-secret values only.
`validate.sh` checks that every key is a parameter of its template and that every parameter
without a default is supplied.

## `bootstrap`

| Output | Used by |
|---|---|
| `ExecutionRoleArn` | every other stack deploy (`--role-arn`) |
| `DeployerPolicyArn` | attach to whoever runs the scripts; `check-deployer-policy.sh`, `local-up.sh --iam` |

The execution role can manage EC2/VPC, load balancing, ECS, ECR, logs, S3, CloudFront and Route53
records, read ACM certificates, and create or pass only IAM roles named
`<ProjectName>-<Environment>-*`. The deployer policy grants CloudFormation on
`<ProjectName>-<Environment>-*` stacks, `iam:PassRole` for the execution role only (to
CloudFormation), ECR push and pull on this environment's repositories, the landing bucket, and
CloudFront invalidations.

## `network`

| Parameter | Notes |
|---|---|
| `WebHost`, `AdminHost` | Host names the ALB routes on |
| `EnableHttps` | `true` outside `local`. HTTP then only redirects |
| `AcmCertificateArn` | Certificate covering both hosts (regional, same region as the stack) |
| `HttpListenerPort` | `80`; `8080` locally |
| `HostedZoneId` | Optional; creates alias A records for both hosts |
| `VpcCidr`, subnet CIDRs, `AppContainerPort` | Defaults are fine |

| Output / export | Used by |
|---|---|
| `WebUrl`, `AdminUrl` | landing build, Convex origin sync, smoke checks |
| `PrivateSubnetIds`, `ServiceSecurityGroupId` | `apps` |
| `WebTargetGroupArn`, `AdminTargetGroupArn` | `apps` |
| `AlbDnsName` | DNS records you manage yourself |

## `registry`

| Parameter | Notes |
|---|---|
| `TaggedImageRetentionCount` | How many SHA-tagged images to keep per app (default 50). Rollback reaches only these without a rebuild |
| `UntaggedImageRetentionDays` | Default 7 |

Outputs `WebRepositoryUri`, `AdminRepositoryUri` (imported by `apps`, used to push).

## `landing`

| Parameter | Notes |
|---|---|
| `LandingDomainName` | Optional custom domain; needs `AcmCertificateArn` |
| `AcmCertificateArn` | Must be in **us-east-1** (CloudFront) |
| `HostedZoneId` | Optional; creates the alias record for `LandingDomainName` |

| Output / export | Used by |
|---|---|
| `LandingUrl` | `apps` (`LANDING_URL`), landing build, Convex origin sync |
| `LandingBucketName`, `LandingCloudFrontDistributionId` | `deploy-landing.sh` |

A missing object (403 from S3 behind OAC) is served as the exported `404.html` with status 404.
Directory URLs (`/en/`) work because `deploy-landing.sh` also stores each page under its
directory keys; no CloudFront Function is involved.

## `apps`

| Parameter | Notes |
|---|---|
| `WebImageTag`, `AdminImageTag` | Supplied by `deploy-app-services.sh`; not in parameter files |
| `ConvexUrl`, `ConvexSiteUrl` | Convex Cloud deployment (`https://<name>.convex.cloud` / `.convex.site`). For `local`: the local target's Convex backend, `http://convex.localhost.floci.io:3310` / `:3311` |
| `AppEnvironment` | Environment banner: `staging`; empty in production; `development` locally |
| `TrustedProxyCount` | `1` (the ALB); see the architecture doc |
| `CpuArchitecture` | `ARM64` (Graviton) or `X86_64`; images are built for it |
| `WebDesiredCount`, `AdminDesiredCount`, `*Cpu`, `*Memory` | Sizing |
| `LogRetentionDays` | CloudWatch log retention |

Outputs `ClusterName`, `WebServiceName`, `AdminServiceName`, and `WebImageTag` / `AdminImageTag`
(what is deployed; `image_tag_for` compares against these to skip unchanged apps).

Services use the ECS deployment circuit breaker with rollback, `MinimumHealthyPercent` 100 and
`MaximumPercent` 200. Target groups health-check `/` (web redirects to a locale, admin to
sign-in; 200–399 is healthy).

## Environment variables in the task definitions

| Variable | web | admin |
|---|---|---|
| `CONVEX_URL`, `CONVEX_SITE_URL` | ✓ | ✓ |
| `LANDING_URL` | ✓ | |
| `APP_ENVIRONMENT` | ✓ | ✓ |
| `TRUSTED_PROXY_COUNT` | ✓ | ✓ |
| `PORT`, `HOSTNAME` | ✓ | ✓ |

Build identity (`NEXT_PUBLIC_GIT_SHA`, `NEXT_PUBLIC_BUILD_ID`, `NEXT_PUBLIC_APP_NAME`,
`NEXT_PUBLIC_GIT_BRANCH`, `NEXT_PUBLIC_DEPLOY_TIMESTAMP`) is baked into the image at build time,
where it belongs.
