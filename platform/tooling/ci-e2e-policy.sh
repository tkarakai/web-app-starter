#!/usr/bin/env bash
# E2E policy for the platform CI workflows (platform/docs/ci.md#e2e-on-pull-requests).
#
#   ci-e2e-policy.sh resolve   Decide this run's E2E: writes e2e=run|skip|on-demand to $GITHUB_OUTPUT.
#                              Env: PR_E2E (vars.PLATFORM_CI_PR_E2E), REQUIRE_E2E (inputs.require_e2e),
#                              EVENT_NAME, DRAFT, and REPO_PRIVATE (set by one workflow only, so a
#                              private repository that hasn't chosen a mode sees the notice once per
#                              push).
#   ci-e2e-policy.sh label     on-demand mode: succeed when the pull request has the run-e2e label.
#                              Labels are read live, so a re-run sees a label added after the push.
#                              Env: GITHUB_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY, PR_NUMBER.
set -euo pipefail

LABEL=run-e2e

output() {
  echo "$1" >> "${GITHUB_OUTPUT:-/dev/stdout}"
}

resolve() {
  # CI Verify Commit, the staging deploy and any non-PR trigger always run E2E.
  if [[ "${REQUIRE_E2E:-false}" == "true" || "${EVENT_NAME:-}" != "pull_request" ]]; then
    output e2e=run
    return
  fi

  local mode="${PR_E2E:-}"
  if [[ -z "$mode" && "${REPO_PRIVATE:-}" == "true" ]]; then
    echo "::notice title=E2E runs on every push to a ready PR::This private repository pays for Actions minutes, and E2E is most of each run. Set the repository variable PLATFORM_CI_PR_E2E to on-demand or off to spend less, or to always to keep this and hide this notice (platform/docs/private-repo-ci.md)."
  fi
  case "${mode:-always}" in
    always | on-demand | off) ;;
    *)
      echo "::error title=Invalid PLATFORM_CI_PR_E2E::'$mode' is not a mode. Use always, on-demand or off (platform/docs/ci.md#e2e-on-pull-requests)."
      exit 1
      ;;
  esac

  if [[ "${DRAFT:-false}" == "true" ]]; then
    echo "E2E skipped: draft pull request"
    output e2e=skip
    return
  fi
  case "${mode:-always}" in
    always) output e2e=run ;;
    on-demand) output e2e=on-demand ;;
    off)
      echo "E2E skipped: PLATFORM_CI_PR_E2E=off"
      output e2e=skip
      ;;
  esac
}

label() {
  local labels
  labels=$(curl -fsSL \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "${GITHUB_API_URL:-https://api.github.com}/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels?per_page=100")
  if grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"$LABEL\"" <<< "$labels"; then
    echo "E2E requested with the $LABEL label"
    return
  fi
  echo "::error title=E2E required before merge::PLATFORM_CI_PR_E2E=on-demand: add the '$LABEL' label to this pull request when it is ready. The label re-runs this check and the E2E tests."
  exit 1
}

case "${1:-}" in
  resolve) resolve ;;
  label) label ;;
  *)
    echo "Usage: $0 resolve|label" >&2
    exit 2
    ;;
esac
