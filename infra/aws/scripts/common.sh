#!/usr/bin/env bash
# Shared helpers for the AWS operator scripts. Source, don't execute.
#
# Every script takes --env <local|staging|production>. `local` targets a Floci
# emulator (infra/aws/local) instead of a real AWS account; everything else is
# identical, which is the point: the same templates and scripts run in both.
#
# Variables set here (ENV, SHA, PROJECT_NAME, the stack lists, ...) are read by
# the scripts that source this file.
# shellcheck disable=SC2034

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${AWS_ROOT}/../.." && pwd)"

# Stacks managed by deploy-stacks.sh, in dependency order. `apps` is deployed by
# deploy-app-services.sh because it needs image tags.
INFRA_STACKS=(network registry landing)
ALL_STACKS=(bootstrap network registry landing apps)

FLOCI_ENDPOINT="${FLOCI_ENDPOINT:-http://localhost:4566}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

# Parse the flags every script shares. Sets ENV, PROFILE, SHA and REST (unparsed args).
parse_common_args() {
  ENV=""
  SHA=""
  PROFILE="${AWS_PROFILE:-}"
  REST=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env) ENV="${2:-}"; shift ;;
      --sha) SHA="${2:-}"; shift ;;
      --profile) PROFILE="${2:-}"; shift ;;
      *) REST+=("$1") ;;
    esac
    shift
  done
  [[ -n "$ENV" ]] || die "Missing --env <local|staging|production>"
  case "$ENV" in
    local | staging | production) ;;
    *) die "Invalid env: $ENV (expected local, staging or production)" ;;
  esac
  if [[ "$ENV" == "local" ]]; then
    # Floci accepts any credentials; never let a real profile leak into a local run.
    PROFILE=""
    export AWS_ENDPOINT_URL="$FLOCI_ENDPOINT"
    export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
    export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
    unset AWS_PROFILE AWS_SESSION_TOKEN
  fi
  PROJECT_NAME="$(project_name_for_env "$ENV")"
  REGION="$(region_for_env)"
}

# Resolve a --sha argument to a full commit SHA (default: HEAD).
resolve_sha() {
  local ref="${1:-HEAD}"
  git -C "$REPO_ROOT" rev-parse --verify --quiet "${ref}^{commit}" || die "Not a commit in this repository: $ref"
}

param_file() {
  echo "${AWS_ROOT}/params/$1/$2.json"
}

template_file() {
  echo "${AWS_ROOT}/cloudformation/$1.yaml"
}

get_param_from_file() {
  jq -r --arg k "$2" '.[] | select(.ParameterKey == $k) | .ParameterValue' "$1" | head -n1
}

project_name_for_env() {
  local file project
  file="$(param_file "$1" network)"
  [[ -f "$file" ]] || die "Missing param file: $file"
  project="$(get_param_from_file "$file" ProjectName)"
  [[ -n "$project" && "$project" != "null" ]] || die "ProjectName not set in $file"
  echo "$project"
}

region_for_env() {
  if [[ -n "${AWS_REGION:-}" ]]; then
    echo "$AWS_REGION"
  elif [[ -n "${AWS_DEFAULT_REGION:-}" ]]; then
    echo "$AWS_DEFAULT_REGION"
  elif [[ -n "$PROFILE" ]] && aws configure get region --profile "$PROFILE" >/dev/null 2>&1; then
    aws configure get region --profile "$PROFILE"
  else
    echo "us-east-1"
  fi
}

stack_name() {
  echo "${PROJECT_NAME}-${ENV}-$1"
}

# Print "Key=Value" lines for a parameter file (bash 3.2 has no mapfile).
param_overrides() {
  [[ -f "$1" ]] || die "Missing param file: $1"
  jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' "$1"
}

aws_cli() {
  if [[ -n "$PROFILE" ]]; then
    aws --profile "$PROFILE" --region "$REGION" "$@"
  else
    aws --region "$REGION" "$@"
  fi
}

cf_output() {
  local stack="$1" key="$2" value
  value="$(aws_cli cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" --output text 2>/dev/null || true)"
  [[ "$value" == "None" ]] && value=""
  echo "$value"
}

require_output() {
  local value
  value="$(cf_output "$1" "$2")"
  [[ -n "$value" ]] || die "Output $2 missing from stack $1 (has it been deployed?)"
  echo "$value"
}

# `aws cloudformation deploy` for one stack. Extra args are appended as parameter overrides.
deploy_stack() {
  local stack="$1" no_execute="$2"
  shift 2
  local template params name overrides=()
  template="$(template_file "$stack")"
  params="$(param_file "$ENV" "$stack")"
  name="$(stack_name "$stack")"
  [[ -f "$template" ]] || die "Missing template: $template"
  while IFS= read -r line; do overrides+=("$line"); done < <(param_overrides "$params")
  overrides+=("$@")

  # Once an administrator has run bootstrap.sh, CloudFormation acts through the
  # environment's execution role and the caller needs only the deployer policy.
  local role_args=()
  if [[ "$stack" != "bootstrap" ]]; then
    local role
    role="$(cf_output "$(stack_name bootstrap)" ExecutionRoleArn)"
    [[ -n "$role" ]] && role_args=(--role-arn "$role")
  fi

  local cmd=(cloudformation deploy
    --stack-name "$name"
    --template-file "$template"
    --parameter-overrides "${overrides[@]}"
    --capabilities CAPABILITY_NAMED_IAM
    --no-fail-on-empty-changeset
    --tags "Project=${PROJECT_NAME}" "Environment=${ENV}"
    ${role_args[@]+"${role_args[@]}"})
  [[ "$no_execute" == true ]] && cmd+=(--no-execute-changeset)

  # A stack whose first create failed is left in ROLLBACK_COMPLETE, holds no
  # resources and can only be deleted; clear it so the deploy can retry.
  local status
  status="$(aws_cli cloudformation describe-stacks --stack-name "$name" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)"
  if [[ "$status" == "ROLLBACK_COMPLETE" && "$no_execute" != true ]]; then
    log "Stack ${name} is ROLLBACK_COMPLETE from a failed create; deleting it before retrying"
    aws_cli cloudformation delete-stack --stack-name "$name"
    aws_cli cloudformation wait stack-delete-complete --stack-name "$name"
  fi

  log "Deploying stack ${name}"
  aws_cli "${cmd[@]}"
}

# Where local-up.sh keeps state that must not be committed (the local Convex admin key).
LOCAL_STATE_DIR="${AWS_ROOT}/local/.state"

# Forward --profile to a sibling script only when one is set.
profile_args() {
  if [[ -n "$PROFILE" ]]; then
    echo "--profile"
    echo "$PROFILE"
  fi
}

# ---------------------------------------------------------------------------
# Convex (Convex Cloud; hosting Convex on AWS is out of scope)
# ---------------------------------------------------------------------------

# Print "<CONVEX_URL> <CONVEX_SITE_URL>" for the environment: the Convex Cloud
# deployment for staging/production, the local target's Convex backend for local.
convex_urls() {
  local file
  file="$(param_file "$ENV" apps)"
  echo "$(get_param_from_file "$file" ConvexUrl) $(get_param_from_file "$file" ConvexSiteUrl)"
}

# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

# Paths whose changes can alter an app image. Anything else (docs, other apps,
# CI config) leaves the image as it was.
# Both app locations are listed: reference apps live in apps/, platform apps
# (admin) in platform/apps/, and a diff across the v2 move must see either.
app_image_paths() {
  echo "apps/$1/"
  echo "platform/apps/$1/"
  echo "packages/"
  echo "platform/packages/"
  echo "platform/config/"
  echo "app.config.ts"
  echo "package.json"
  echo "bun.lock"
  echo "turbo.json"
  echo "tsconfig.json"
  echo "tsconfig.base.json"
  echo ".node-version"
  echo "platform/tooling/copy-shared-assets.sh"
  echo "platform/tooling/check-env-leak.sh"
  echo "infra/aws/docker/"
}

# The image tag currently deployed for an app ("" before the first deploy).
deployed_image_tag() {
  local key
  case "$1" in
    web) key=WebImageTag ;;
    admin) key=AdminImageTag ;;
    *) die "Unknown app: $1" ;;
  esac
  cf_output "$(stack_name apps)" "$key"
}

# The image tag to run for an app at a commit. Images are tagged by the commit
# they were built from; when nothing that affects the image changed between the
# deployed tag and the target commit, the deployed image is the same build and is
# reused rather than rebuilt (the equivalent of main's content-addressed artifacts).
image_tag_for() {
  local app="$1" sha="$2" deployed paths=()
  deployed="$(deployed_image_tag "$app")"
  if [[ -n "$deployed" ]] && git -C "$REPO_ROOT" cat-file -e "${deployed}^{commit}" 2>/dev/null; then
    while IFS= read -r p; do paths+=("$p"); done < <(app_image_paths "$app")
    if git -C "$REPO_ROOT" diff --quiet "$deployed" "$sha" -- "${paths[@]}"; then
      echo "$deployed"
      return
    fi
  fi
  echo "$sha"
}

repository_uri() {
  local key
  case "$1" in
    web) key=WebRepositoryUri ;;
    admin) key=AdminRepositoryUri ;;
    *) die "Unknown app: $1" ;;
  esac
  require_output "$(stack_name registry)" "$key"
}

image_exists() {
  local app="$1" tag="$2" repo
  repo="${PROJECT_NAME}-${ENV}-${app}"
  aws_cli ecr describe-images --repository-name "$repo" --image-ids "imageTag=${tag}" >/dev/null 2>&1
}
