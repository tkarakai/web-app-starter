#!/usr/bin/env bash
# Start the `local` deployment target and deploy a commit into it with the same
# stacks and scripts as AWS.
#
#   infra/aws/local/local-up.sh [--sha <commit>] [--force] [--no-deploy] [--iam]
#
# --iam turns on Floci's IAM policy enforcement, bootstraps the environment as
# the account's administrator, then deploys as a user holding only the deployer
# policy from bootstrap.yaml. It proves the policy grants every action the
# scripts call. Floci evaluates CloudFormation, ECR, CloudFront and IAM actions
# against resource "*" rather than the resource's ARN, so the user gets the
# policy's statements with their resources widened to "*": the action list is
# tested here, the resource scoping only on AWS (see the runbook). What
# CloudFormation does through the execution role is not evaluated either.
#
# Needs only Docker: Floci stands in for AWS, and a Convex backend container for
# the environment's Convex Cloud deployment. `bun run dev` is not involved.
set -euo pipefail
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${LOCAL_DIR}/../scripts/common.sh"
require_cmd docker
require_cmd curl

DEPLOY=true
IAM=false
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-deploy) DEPLOY=false ;;
    --iam) IAM=true ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

parse_common_args --env local
export COMPOSE_PROJECT_NAME="${PROJECT_NAME}-aws-local"
export FLOCI_IAM_ENFORCEMENT="$IAM"
COMPOSE=(docker compose -f "${LOCAL_DIR}/compose.yaml")

"${LOCAL_DIR}/build-floci.sh"

log "Starting Floci and the local Convex backend (${COMPOSE_PROJECT_NAME})"
"${COMPOSE[@]}" up -d --wait floci convex convex-relay

for _ in $(seq 1 30); do
  curl -sf -o /dev/null "${FLOCI_ENDPOINT}/_floci/health" && break
  sleep 1
done
curl -sf -o /dev/null "${FLOCI_ENDPOINT}/_floci/health" || die "Floci did not become healthy at ${FLOCI_ENDPOINT}"

read -r CONVEX_URL _ <<<"$(convex_urls)"
curl -sf -o /dev/null "${CONVEX_URL}/version" || die "The local Convex backend is not reachable at ${CONVEX_URL}"

# The admin key is derived from the backend's instance secret, which lives in its
# data volume; deploy-convex.sh reads it from here.
mkdir -p "$LOCAL_STATE_DIR"
"${COMPOSE[@]}" exec -T convex ./generate_admin_key.sh 2>/dev/null | tail -n1 > "${LOCAL_STATE_DIR}/convex-admin-key"
[[ -s "${LOCAL_STATE_DIR}/convex-admin-key" ]] || die "Could not generate the local Convex admin key"
chmod 600 "${LOCAL_STATE_DIR}/convex-admin-key"

# Stream the local deployment's function logs to a file, as `bun run dev` does
# into .convex-dev.log: auth emails without RESEND_API_KEY are only logged, and
# the E2E suite reads them from there (E2E_CONVEX_LOG).
if [[ -f "${LOCAL_STATE_DIR}/convex-logs.pid" ]]; then
  kill "$(cat "${LOCAL_STATE_DIR}/convex-logs.pid")" 2>/dev/null || true
fi
LOGS_DIR="${LOCAL_STATE_DIR}/convex-logs-project"
mkdir -p "$LOGS_DIR"
printf '{"private":true,"dependencies":{"convex":"*"}}\n' > "${LOGS_DIR}/package.json"
(
  cd "$LOGS_DIR"
  CONVEX_SELF_HOSTED_URL="$CONVEX_URL" \
  CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat "${LOCAL_STATE_DIR}/convex-admin-key")" \
    nohup "${REPO_ROOT}/packages/backend/node_modules/.bin/convex" logs >> "${LOCAL_STATE_DIR}/convex.log" 2>&1 &
  echo $! > "${LOCAL_STATE_DIR}/convex-logs.pid"
)

log "Floci: ${FLOCI_ENDPOINT} (console ${FLOCI_ENDPOINT}/_floci/ui)"
log "Convex: ${CONVEX_URL} (function logs: ${LOCAL_STATE_DIR}/convex.log)"

if [[ "$IAM" == true ]]; then
  # As the administrator (Floci's default credentials): bootstrap, then a user
  # holding nothing but the deployer policy, whose keys run the deploy.
  "${AWS_ROOT}/scripts/bootstrap.sh" --env local
  DEPLOYER="${PROJECT_NAME}-local-deployer"
  aws_cli iam get-user --user-name "$DEPLOYER" >/dev/null 2>&1 || aws_cli iam create-user --user-name "$DEPLOYER" >/dev/null
  POLICY_ARN="$(cf_output "$(stack_name bootstrap)" DeployerPolicyArn)"
  POLICY_VERSION="$(aws_cli iam get-policy --policy-arn "$POLICY_ARN" --query Policy.DefaultVersionId --output text)"
  aws_cli iam get-policy-version --policy-arn "$POLICY_ARN" --version-id "$POLICY_VERSION" \
    --query PolicyVersion.Document --output json \
    | jq '.Statement |= map(.Resource = "*" | del(.Condition))' > "${LOCAL_STATE_DIR}/deployer-policy-actions.json"
  aws_cli iam put-user-policy --user-name "$DEPLOYER" --policy-name deployer-actions \
    --policy-document "file://${LOCAL_STATE_DIR}/deployer-policy-actions.json"
  read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY <<<"$(aws_cli iam create-access-key --user-name "$DEPLOYER" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  log "IAM enforcement on; deploying as ${DEPLOYER} (deployer policy only)"
fi

if [[ "$DEPLOY" == true ]]; then
  "${AWS_ROOT}/scripts/deploy-manual.sh" --env local ${ARGS[@]+"${ARGS[@]}"}
fi
