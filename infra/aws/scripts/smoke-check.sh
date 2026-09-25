#!/usr/bin/env bash
# Check that every deployed surface answers, and that web/admin picked up their
# runtime Convex configuration.
#
#   smoke-check.sh --env <local|staging|production> [--profile <p>]
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd curl

parse_common_args "$@"
[[ ${#REST[@]} -eq 0 ]] || die "Unknown argument: ${REST[0]}"

WEB_URL="$(require_output "$(stack_name network)" WebUrl)"
ADMIN_URL="$(require_output "$(stack_name network)" AdminUrl)"
LANDING_URL="$(require_output "$(stack_name landing)" LandingUrl)"
read -r CONVEX_URL _ <<<"$(convex_urls)"

failures=0

# check <name> <url> <status-regex> [<body substring>]
check() {
  local name="$1" url="$2" want="$3" needle="${4:-}" attempt code body
  body="$(mktemp)"
  for attempt in 1 2 3 4 5; do
    code="$(curl -sS -o "$body" -w '%{http_code}' --connect-timeout 5 --max-time 20 "$url" || true)"
    if [[ "$code" =~ $want ]] && { [[ -z "$needle" ]] || grep -qF "$needle" "$body"; }; then
      log "OK   ${name} (${code}) ${url}"
      rm -f "$body"
      return 0
    fi
    sleep $((attempt * 2))
  done
  log "FAIL ${name} (${code}) ${url}${needle:+ (expected body to contain ${needle})}"
  rm -f "$body"
  failures=$((failures + 1))
}

CONVEX_HOST="$(sed -E 's#^https?://([^/:]+).*#\1#' <<<"$CONVEX_URL")"

check "convex" "${CONVEX_URL}/version" '^200$'
if [[ "$WEB_URL" == https://* ]]; then
  HTTP_PORT="$(get_param_from_file "$(param_file "$ENV" network)" HttpListenerPort)"
  HTTP_URL="http://${WEB_URL#https://}"
  [[ "$HTTP_PORT" != 80 ]] && HTTP_URL="${HTTP_URL}:${HTTP_PORT}"
  check "web plain HTTP redirects to HTTPS" "${HTTP_URL}/" '^301$'
fi
check "web root" "${WEB_URL}/" '^(200|30[178])$'
check "web sign-in (runtime Convex URL)" "${WEB_URL}/en/sign-in" '^200$' "$CONVEX_HOST"
check "admin sign-in (runtime Convex URL)" "${ADMIN_URL}/sign-in" '^200$' "$CONVEX_HOST"
check "landing root" "${LANDING_URL}/" '^200$'
check "landing locale page" "${LANDING_URL}/en/" '^200$'

[[ "$failures" -eq 0 ]] || die "${failures} smoke check(s) failed for env=${ENV}"
log "Smoke checks passed for env=${ENV}"
