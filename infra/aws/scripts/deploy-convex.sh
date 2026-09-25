#!/usr/bin/env bash
# Deploy Convex functions for a commit and point Convex at the AWS-hosted apps.
#
#   CONVEX_DEPLOY_KEY=... deploy-convex.sh --env <local|staging|production> [--sha <commit>] [--profile <p>] [--replace-origins] [--skip-deploy]
#
# Convex stays on Convex Cloud: this runs the same `convex deploy` + migrations
# as .github/actions/deploy-convex, with the environment's deploy key supplied
# in CONVEX_DEPLOY_KEY (the same key the GitHub environment secret holds).
#
# It then adds the AWS origins to the deployment's SITE_URL, ADMIN_SITE_URL and
# LANDING_URL (comma-separated allow-lists for CORS and Better Auth). By default
# existing entries are kept, so a Convex deployment can serve Vercel and AWS
# side by side during a migration. --replace-origins makes the AWS origins the
# only ones, for the cutover. The first SITE_URL entry is the one used in email
# links, so it stays first until --replace-origins.
#
# local: the local target's own Convex backend (infra/aws/local), reached as a
# self-hosted deployment with the admin key local-up.sh generated. It belongs to
# the local target alone, so its origins are set outright and the settings in
# infra/aws/local/convex.env are applied.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq
require_cmd git
require_cmd bun

parse_common_args "$@"
REPLACE=false
SKIP_DEPLOY=false
for arg in ${REST[@]+"${REST[@]}"}; do
  case "$arg" in
    --replace-origins) REPLACE=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    *) die "Unknown argument: $arg" ;;
  esac
done
SHA="$(resolve_sha "${SHA:-HEAD}")"
if [[ "$ENV" == "local" ]]; then
  unset CONVEX_DEPLOY_KEY
  read -r CONVEX_SELF_HOSTED_URL _ <<<"$(convex_urls)"
  [[ -s "${LOCAL_STATE_DIR}/convex-admin-key" ]] || die "No local Convex admin key; run infra/aws/local/local-up.sh"
  CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat "${LOCAL_STATE_DIR}/convex-admin-key")"
  export CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
  REPLACE=true
else
  [[ -n "${CONVEX_DEPLOY_KEY:-}" ]] || die "Set CONVEX_DEPLOY_KEY to the ${ENV} Convex deploy key"
fi

WEB_URL="$(require_output "$(stack_name network)" WebUrl)"
ADMIN_URL="$(require_output "$(stack_name network)" AdminUrl)"
LANDING_URL="$(require_output "$(stack_name landing)" LandingUrl)"

# The CLI runs outside packages/backend, so a developer's packages/backend/.env.local
# (which names their dev deployment) can never redirect it.
CONVEX_BIN="${REPO_ROOT}/packages/backend/node_modules/.bin/convex"
[[ -x "$CONVEX_BIN" ]] || die "Convex CLI not found; run bun install"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ "$SKIP_DEPLOY" == false ]]; then
  log "Exporting ${SHA:0:12} for the Convex deploy"
  git -C "$REPO_ROOT" archive "$SHA" | tar -x -C "$TMP_DIR"
  (cd "$TMP_DIR" && bun install --frozen-lockfile >/dev/null)

  log "Deploying Convex functions (${ENV})"
  (cd "$TMP_DIR/packages/backend" && bunx convex deploy --cmd 'echo "skip build"')
  log "Running pending migrations (${ENV})"
  (cd "$TMP_DIR/packages/backend" && bunx convex run migrations)
fi

# `convex env` wants a project whose package.json lists convex; give it an empty one.
ENV_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR" "$ENV_DIR"' EXIT
printf '{"private":true,"dependencies":{"convex":"*"}}\n' > "${ENV_DIR}/package.json"
convex_env() {
  (cd "$ENV_DIR" && "$CONVEX_BIN" env "$@")
}

# Append an origin to a comma-separated list unless it is already there.
merge_origin() {
  local current="$1" origin="$2"
  if [[ -z "$current" ]]; then
    echo "$origin"
  elif tr ',' '\n' <<<"$current" | sed 's/^ *//;s/ *$//' | grep -qxF "$origin"; then
    echo "$current"
  else
    echo "${current},${origin}"
  fi
}

# Set an allow-list to the given origins. By default they are added to what is
# there; with --replace-origins (and for local) they become the whole list.
sync_origins() {
  local name="$1" current next origin
  shift
  current="$(convex_env get "$name" 2>/dev/null | tr -d '\r\n' || true)"
  if [[ "$REPLACE" == true ]]; then
    next="$(IFS=,; echo "$*")"
  else
    next="$current"
    for origin in "$@"; do next="$(merge_origin "$next" "$origin")"; done
  fi
  if [[ "$next" == "$current" ]]; then
    log "${name} already allows $*"
  else
    convex_env set "$name" "$next" >/dev/null
    log "${name} = ${next}"
  fi
}

# SITE_URL is Better Auth's list of trusted origins, so it holds both apps that
# sign users in (web first: its first entry is the base URL for email links),
# as the Vercel setup does. ADMIN_SITE_URL and LANDING_URL are CORS and link
# settings.
sync_origins SITE_URL "$WEB_URL" "$ADMIN_URL"
sync_origins ADMIN_SITE_URL "$ADMIN_URL"
sync_origins LANDING_URL "$LANDING_URL"

if [[ "$ENV" == "local" ]]; then
  while IFS='=' read -r name value; do
    [[ -z "$name" || "$name" == \#* ]] && continue
    if [[ "$(convex_env get "$name" 2>/dev/null | tr -d '\r\n' || true)" != "$value" ]]; then
      convex_env set "$name" "$value" >/dev/null
      log "${name} = ${value}"
    fi
  done < "${AWS_ROOT}/local/convex.env"
  if [[ -z "$(convex_env get BETTER_AUTH_SECRET 2>/dev/null | tr -d '\r\n' || true)" ]]; then
    convex_env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" >/dev/null
    log "BETTER_AUTH_SECRET generated"
  fi
  # The dev seed accounts, as `bun run dev` creates them (idempotent).
  (cd "$ENV_DIR" && "$CONVEX_BIN" run devSeed:seed >/dev/null) && log "Dev seed applied"
fi

# BETTER_AUTH_SECRET, RESEND_API_KEY, EMAIL_FROM and PASSKEY_RP_ID are managed
# on the Convex deployment exactly as they are for Vercel. Only check the one
# the apps cannot run without.
if [[ -z "$(convex_env get BETTER_AUTH_SECRET 2>/dev/null | tr -d '\r\n' || true)" ]]; then
  die "BETTER_AUTH_SECRET is not set on the Convex ${ENV} deployment (see docs/aws/deployment-runbook-aws.md)"
fi

log "Convex ready for env=${ENV}"
