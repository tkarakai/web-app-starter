#!/usr/bin/env bash
# One-time, per environment, run by an administrator: create the CloudFormation
# execution role and the deployer policy (cloudformation/bootstrap.yaml).
#
#   bootstrap.sh --env <local|staging|production> [--profile <admin-profile>]
#
# Afterwards every stack is deployed through the execution role, and whoever
# runs the deploy scripts (a person or CI) needs only the deployer policy that
# this prints. Attach it to their IAM Identity Center permission set, role or
# user. Re-run after changing bootstrap.yaml.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_cmd aws
require_cmd jq

parse_common_args "$@"
[[ ${#REST[@]} -eq 0 ]] || die "Unknown argument: ${REST[0]}"

deploy_stack bootstrap false
log "Execution role: $(cf_output "$(stack_name bootstrap)" ExecutionRoleArn)"
log "Deployer policy: $(cf_output "$(stack_name bootstrap)" DeployerPolicyArn)"
