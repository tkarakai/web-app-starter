#!/usr/bin/env bash
# Native TruffleHog for Linux Actions runners without Docker access.
set -euo pipefail

version=3.90.12
# Official release checksums:
# https://github.com/trufflesecurity/trufflehog/releases/download/v3.90.12/trufflehog_3.90.12_checksums.txt
case "$(uname -s)/$(uname -m)" in
  Linux/aarch64|Linux/arm64)
    arch=arm64
    checksum=15078ea4a0b8ac7472a94fcad9d09ef1b2853130a153b74872d96e4c0d660386 ;;
  Linux/x86_64|Linux/amd64)
    arch=amd64
    checksum=318fd1e8af68b54f4465437208582003a5948293ea401c5c67bb55f17e4e2102 ;;
  *) echo 'Unsupported runner: TruffleHog requires Linux arm64 or amd64' >&2; exit 1 ;;
esac

base=''
case "${SCAN_EVENT:?SCAN_EVENT is required}" in
  pull_request)
    base=${SCAN_PR_BASE:?SCAN_PR_BASE is required}
    head=${SCAN_PR_HEAD:?SCAN_PR_HEAD is required} ;;
  push)
    base=${SCAN_BEFORE:?SCAN_BEFORE is required}
    head=${SCAN_AFTER:?SCAN_AFTER is required}
    if [[ "$base" == 0000000000000000000000000000000000000000 ]]; then base=''; fi ;;
  schedule|workflow_dispatch)
    head=${SCAN_SHA:?SCAN_SHA is required} ;;
  *) echo 'Unsupported scan event' >&2; exit 1 ;;
esac
# Event values must be commit IDs, never shell fragments or Git options.
for ref in "$head" ${base:+"$base"}; do
  if [[ ! "$ref" =~ ^[0-9a-fA-F]{40}$ ]]; then echo 'Invalid scan commit ID' >&2; exit 1; fi
  git cat-file -e "${ref}^{commit}"
done
# Scan full history when the supplied endpoints coincide (e.g. scheduled/default
# branch checks), rather than reporting success after scanning an empty range.
if [[ "$base" == "$head" ]]; then base=''; fi

# A full-history checkout can still inherit a partial clone's promised objects.
# TruffleHog clones every ref over file://, where upload-pack cannot lazy-fetch.
# Re-fetch complete packs from the configured trusted promisor remotes first.
while IFS= read -r remote; do
  if [[ "$(git config --get "remote.${remote}.promisor" || true)" == true ]]; then
    { printf '%s\n' "$head" ${base:+"$base"}; git rev-parse HEAD; git for-each-ref --format='%(objectname)'; } |
      git fetch --stdin --refetch --no-filter "$remote"
  fi
done < <(git remote)
GIT_NO_LAZY_FETCH=1 git rev-list --objects --all "$head" ${base:+"$base"} --missing=error > /dev/null

scratch=$(mktemp -d "${RUNNER_TEMP:?RUNNER_TEMP is required}/trufflehog.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
archive="trufflehog_${version}_linux_${arch}.tar.gz"
curl --fail --silent --show-error --location \
  "https://github.com/trufflesecurity/trufflehog/releases/download/v${version}/${archive}" \
  --output "$scratch/$archive"
printf '%s  %s\n' "$checksum" "$scratch/$archive" | sha256sum --check --status
tar -xzf "$scratch/$archive" -C "$scratch" trufflehog
args=(git "file://$(pwd)" --branch "$head" --only-verified --fail --no-update --github-actions)
if [[ -n "$base" ]]; then args+=(--since-commit "$base"); fi
"$scratch/trufflehog" "${args[@]}"
