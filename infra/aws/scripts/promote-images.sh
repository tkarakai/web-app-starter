#!/usr/bin/env bash
# Copy the images an environment is running into another environment's registry,
# so production runs the bits staging tested instead of a rebuild.
#
#   promote-images.sh --env production --from staging [--sha <commit>] [--profile <p>] [--from-profile <p>]
#
# For each app, takes the tag the source environment has deployed and refuses if
# that image is not equivalent to --sha (its inputs differ), i.e. if the commit
# was not what the source environment tested. Prints "web=<tag> admin=<tag>" on
# stdout for deploy-app-services.sh.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq
require_cmd git
require_cmd docker

parse_common_args "$@"
FROM=""
FROM_PROFILE="$PROFILE"
set -- ${REST[@]+"${REST[@]}"}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:-}"; shift ;;
    --from-profile) FROM_PROFILE="${2:-}"; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done
[[ -n "$FROM" && "$FROM" != "$ENV" ]] || die "Missing or invalid --from <env>"
[[ "$FROM" != local && "$ENV" != local ]] || die "Promotion is between AWS environments"
SHA="$(resolve_sha "${SHA:-HEAD}")"

# Read the source environment's state with its own profile and names.
TARGET_PROFILE="$PROFILE"
TARGET_PROJECT="$PROJECT_NAME"
PROFILE="$FROM_PROFILE"
PROJECT_NAME="$(project_name_for_env "$FROM")"
ENV_SAVED="$ENV"
ENV="$FROM"
declare_tags=""
for app in web admin; do
  tag="$(deployed_image_tag "$app")"
  [[ -n "$tag" ]] || die "${FROM} has no ${app} image deployed"
  paths=()
  while IFS= read -r p; do paths+=("$p"); done < <(app_image_paths "$app")
  git -C "$REPO_ROOT" diff --quiet "$tag" "$SHA" -- "${paths[@]}" \
    || die "${FROM} runs ${app} ${tag:0:12}, which differs from ${SHA:0:12}; deploy ${SHA:0:12} to ${FROM} first"
  src_repo="$(repository_uri "$app")"
  declare_tags="${declare_tags}${app} ${tag} ${src_repo}"$'\n'
done
SRC_REGISTRY_PROFILE="$PROFILE"
PROFILE="$TARGET_PROFILE"
PROJECT_NAME="$TARGET_PROJECT"
ENV="$ENV_SAVED"

registry_login() {
  local registry="${1%%/*}" profile="$2"
  if [[ -n "$profile" ]]; then
    aws --profile "$profile" --region "$REGION" ecr get-login-password
  else
    aws --region "$REGION" ecr get-login-password
  fi | docker login --username AWS --password-stdin "$registry" >/dev/null
}

result=""
while read -r app tag src_repo; do
  [[ -n "$app" ]] || continue
  result="${result}${app}=${tag} "
  if image_exists "$app" "$tag"; then
    log "${app}: ${tag:0:12} already in ${ENV}"
    continue
  fi
  dst_repo="$(repository_uri "$app")"
  registry_login "$src_repo" "$SRC_REGISTRY_PROFILE"
  registry_login "$dst_repo" "$PROFILE"
  log "${app}: copying ${tag:0:12} from ${FROM} to ${ENV}"
  docker pull --quiet "${src_repo}:${tag}" >/dev/null
  docker tag "${src_repo}:${tag}" "${dst_repo}:${tag}"
  docker push --quiet "${dst_repo}:${tag}" >/dev/null
done <<<"$declare_tags"

echo "${result% }"
