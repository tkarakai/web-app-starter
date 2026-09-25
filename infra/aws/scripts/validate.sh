#!/usr/bin/env bash
# Validate templates and parameter files before a deploy.
#
#   validate.sh --env <local|staging|production> [--profile <p>] [--skip-aws]
#
# Catches the mistakes that otherwise surface halfway through a deploy: a
# parameter the template does not declare, a required one that is missing, and
# (staging/production) placeholder hosts, a missing certificate or an unset
# Convex deployment URL.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd jq

parse_common_args "$@"
SKIP_AWS=false
for arg in ${REST[@]+"${REST[@]}"}; do
  case "$arg" in
    --skip-aws) SKIP_AWS=true ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

errors=0
fail() {
  local msg="$*"
  printf '  - %s\n' "${msg//${REPO_ROOT}\//}" >&2
  errors=$((errors + 1))
}

# Parameters a template declares, as "Name<TAB>required|optional".
template_params() {
  awk '
    /^Parameters:/ { inp = 1; next }
    inp && /^[^ #]/ { inp = 0 }
    inp && /^  [A-Za-z0-9]+:/ { if (name != "") print name "\t" (def ? "optional" : "required"); name = $1; sub(":", "", name); def = 0; next }
    inp && /^    Default:/ { def = 1 }
    END { if (name != "") print name "\t" (def ? "optional" : "required") }
  ' "$1"
}

# Supplied by the deploy scripts rather than the parameter files.
injected_params() {
  case "$1" in
    apps) printf '%s\n' WebImageTag AdminImageTag ;;
  esac
}

for stack in "${ALL_STACKS[@]}"; do
  template="$(template_file "$stack")"
  params="$(param_file "$ENV" "$stack")"
  [[ -f "$template" ]] || { fail "missing template ${template}"; continue; }
  [[ -f "$params" ]] || { fail "missing parameter file ${params}"; continue; }
  jq -e 'type == "array" and all(.[]; has("ParameterKey") and has("ParameterValue"))' "$params" >/dev/null \
    || { fail "${params} is not a list of {ParameterKey, ParameterValue}"; continue; }

  declared="$(template_params "$template")"
  supplied="$(jq -r '.[].ParameterKey' "$params"; injected_params "$stack")"
  while IFS= read -r key; do
    grep -q "^${key}	" <<<"$declared" || fail "${params}: ${key} is not a parameter of ${stack}.yaml"
  done < <(jq -r '.[].ParameterKey' "$params")
  while IFS=$'\t' read -r key kind; do
    [[ "$kind" == required ]] && ! grep -qx "$key" <<<"$supplied" && fail "${params}: required parameter ${key} is missing"
  done <<<"$declared"
  [[ "$(get_param_from_file "$params" Environment)" == "$ENV" ]] || fail "${params}: Environment must be ${ENV}"
  [[ "$(get_param_from_file "$params" ProjectName)" == "$PROJECT_NAME" ]] || fail "${params}: ProjectName must match network.json (${PROJECT_NAME})"
done

net="$(param_file "$ENV" network)"
apps="$(param_file "$ENV" apps)"
landing="$(param_file "$ENV" landing)"
if [[ "$ENV" != "local" ]]; then
  for file in "$net" "$apps" "$landing"; do
    if jq -r '.[].ParameterValue' "$file" | grep -qE 'example\.com|REPLACE'; then
      fail "${file}: still contains placeholder values (example.com / REPLACE)"
    fi
  done
  [[ "$(get_param_from_file "$net" EnableHttps)" == "true" ]] || fail "${net}: EnableHttps must be true (passkeys and secure auth cookies need HTTPS)"
  [[ -n "$(get_param_from_file "$net" AcmCertificateArn)" ]] || fail "${net}: AcmCertificateArn is required for HTTPS"
  if [[ -n "$(get_param_from_file "$landing" LandingDomainName)" && -z "$(get_param_from_file "$landing" AcmCertificateArn)" ]]; then
    fail "${landing}: LandingDomainName needs an AcmCertificateArn (in us-east-1)"
  fi
  for key in ConvexUrl ConvexSiteUrl; do
    [[ "$(get_param_from_file "$apps" "$key")" =~ ^https:// ]] || fail "${apps}: ${key} must be the https:// URL of the Convex Cloud deployment"
  done
  [[ "$(get_param_from_file "$apps" AppEnvironment)" == "$([[ "$ENV" == production ]] && echo "" || echo "$ENV")" ]] \
    || fail "${apps}: AppEnvironment should be '$([[ "$ENV" == production ]] && echo "" || echo "$ENV")' for ${ENV}"
fi

if command -v cfn-lint >/dev/null 2>&1; then
  CFN_LINT=(cfn-lint)
elif command -v uvx >/dev/null 2>&1; then
  CFN_LINT=(uvx cfn-lint)
else
  CFN_LINT=()
fi
if [[ ${#CFN_LINT[@]} -gt 0 ]]; then
  log "Running cfn-lint"
  "${CFN_LINT[@]}" "${AWS_ROOT}"/cloudformation/*.yaml || fail "cfn-lint reported problems"
else
  log "cfn-lint not installed; skipping (pipx install cfn-lint)"
fi

if [[ "$SKIP_AWS" == false ]]; then
  require_cmd aws
  for stack in "${ALL_STACKS[@]}"; do
    aws_cli cloudformation validate-template --template-body "file://$(template_file "$stack")" >/dev/null \
      || fail "validate-template rejected ${stack}.yaml"
  done
fi

[[ "$errors" -eq 0 ]] || die "Validation failed for env=${ENV} (${errors} problem(s) above)"
log "Validation passed for env=${ENV}"
