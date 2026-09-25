#!/usr/bin/env bash
# Check the deployer policy against IAM's policy simulator, with the real ARNs
# the scripts touch. Free: it needs only the bootstrap stack (IAM, no charge).
#
#   check-deployer-policy.sh --env <staging|production> [--profile <p>]
#
# The local target (local-up.sh --iam) proves the policy grants every action,
# but Floci evaluates most services against resource "*". This is the
# complement: each action is simulated against the exact stack, repository,
# bucket and role ARNs, and a few actions the deployer must NOT have are
# checked to be denied.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq

parse_common_args "$@"
[[ ${#REST[@]} -eq 0 ]] || die "Unknown argument: ${REST[0]}"
[[ "$ENV" != "local" ]] || die "Use local-up.sh --iam for the local target"

BOOTSTRAP="$(stack_name bootstrap)"
POLICY_ARN="$(require_output "$BOOTSTRAP" DeployerPolicyArn)"
ROLE_ARN="$(require_output "$BOOTSTRAP" ExecutionRoleArn)"
ACCOUNT="$(aws_cli sts get-caller-identity --query Account --output text)"
VERSION="$(aws_cli iam get-policy --policy-arn "$POLICY_ARN" --query Policy.DefaultVersionId --output text)"
POLICY="$(aws_cli iam get-policy-version --policy-arn "$POLICY_ARN" --version-id "$VERSION" \
  --query PolicyVersion.Document --output json)"

stack_arn() { echo "arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/$(stack_name "$1")/00000000-0000-0000-0000-000000000000"; }
repo_arn() { echo "arn:aws:ecr:${REGION}:${ACCOUNT}:repository/${PROJECT_NAME}-${ENV}-$1"; }
BUCKET="$(cf_output "$(stack_name landing)" LandingBucketName)"
BUCKET="${BUCKET:-${PROJECT_NAME}-${ENV}-landing-landingbucket-example}"

failures=0
# expect <allowed|denied> <action> <resource> [context entries...]
expect() {
  local want="$1" action="$2" resource="$3" decision
  shift 3
  local ctx=()
  [[ $# -gt 0 ]] && ctx=(--context-entries "$@")
  decision="$(aws_cli iam simulate-custom-policy --policy-input-list "$POLICY" \
    --action-names "$action" --resource-arns "$resource" ${ctx[@]+"${ctx[@]}"} \
    --query 'EvaluationResults[0].EvalDecision' --output text)"
  if [[ ("$want" == allowed && "$decision" == allowed) || ("$want" == denied && "$decision" != allowed) ]]; then
    log "OK   ${want}: ${action} on ${resource##*:}"
  else
    log "FAIL expected ${want}, got ${decision}: ${action} on ${resource}"
    failures=$((failures + 1))
  fi
}

for stack in network registry landing apps; do
  for action in CreateChangeSet ExecuteChangeSet DescribeStacks DescribeStackEvents DeleteStack; do
    expect allowed "cloudformation:${action}" "$(stack_arn "$stack")"
  done
done
expect allowed iam:PassRole "$ROLE_ARN" \
  "ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string"
for app in web admin; do
  for action in PutImage InitiateLayerUpload UploadLayerPart CompleteLayerUpload BatchCheckLayerAvailability DescribeImages BatchGetImage; do
    expect allowed "ecr:${action}" "$(repo_arn "$app")"
  done
done
expect allowed ecr:GetAuthorizationToken "*"
expect allowed s3:PutObject "arn:aws:s3:::${BUCKET}/en/index.html"
expect allowed s3:ListBucket "arn:aws:s3:::${BUCKET}"
expect allowed cloudfront:CreateInvalidation "arn:aws:cloudfront::${ACCOUNT}:distribution/EXAMPLE"

# Scope: other projects, other environments and direct resource creation stay out of reach.
expect denied cloudformation:ExecuteChangeSet "arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/some-other-stack/00000000-0000-0000-0000-000000000000"
expect denied ecr:PutImage "arn:aws:ecr:${REGION}:${ACCOUNT}:repository/some-other-repo"
expect denied iam:PassRole "arn:aws:iam::${ACCOUNT}:role/some-admin-role" \
  "ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string"
expect denied ec2:CreateVpc "*"
expect denied iam:CreateRole "arn:aws:iam::${ACCOUNT}:role/${PROJECT_NAME}-${ENV}-anything"
expect denied s3:PutObject "arn:aws:s3:::some-other-bucket/x"

[[ "$failures" -eq 0 ]] || die "${failures} policy expectation(s) failed"
log "Deployer policy grants exactly what the scripts need for env=${ENV}"
