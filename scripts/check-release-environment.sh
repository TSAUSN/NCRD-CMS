#!/usr/bin/env bash
# Check the GitHub environment's target before requesting cloud credentials.
set -euo pipefail

fail() { printf 'Release stopped: %s\n' "$*" >&2; exit 1; }
staging="${CMS_RELEASE_STAGING_PROJECT_NUMBER:-}"
production="${CMS_RELEASE_PRODUCTION_PROJECT_NUMBER:-}"

[[ "$staging" =~ ^[1-9][0-9]+$ ]] || fail 'Set the staging project number on the repository.'
if [[ -n "$production" ]]; then
  [[ "$production" =~ ^[1-9][0-9]+$ && "$production" != "$staging" ]] ||
    fail 'Staging and production must have distinct project numbers.'
fi

case "${CMS_RELEASE_TARGET:-}" in
  staging)
    expected="$staging"
    branch="${CMS_STAGING_BRANCH:-staging}"
    [[ "$branch" == staging || "$branch" == staging/* ]] &&
      git check-ref-format "refs/heads/$branch" >/dev/null ||
      fail 'Use staging or a valid branch within staging/.'
    ;;
  production)
    [[ -n "$production" ]] || fail 'Set the production project number on the repository.'
    expected="$production"
    branch=main
    ;;
  *) fail 'Choose the staging or production environment.' ;;
esac

[[ "${GITHUB_REF:-}" == "refs/heads/$branch" ]] ||
  fail 'This release does not match its configured branch.'
[[ "${CMS_DEPLOY_PROJECT_NUMBER:-}" == "$expected" ]] ||
  fail 'This environment does not match its expected project number.'
project="${CMS_DEPLOY_PROJECT:-}"
provider="${CMS_DEPLOY_IDENTITY_PROVIDER:-}"
account="${CMS_DEPLOY_SERVICE_ACCOUNT:-}"
[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail 'Set the environment project ID.'
prefix="projects/$expected/locations/global/workloadIdentityPools/"
[[ "$provider" == "$prefix"* && "${provider#"$prefix"}" =~ ^[a-z0-9-]+/providers/[a-z0-9-]+$ ]] ||
  fail 'Set a federated identity provider in this environment’s project.'
suffix="@$project.iam.gserviceaccount.com"
[[ "$account" == *"$suffix" && "${account%"$suffix"}" =~ ^[a-z][a-z0-9-]+$ ]] ||
  fail 'Set a deployment service account in this environment’s project.'

if [[ "${1:-}" == --github-env ]]; then
  [[ -n "${GITHUB_ENV:-}" ]] || fail 'The runner environment file is missing.'
  # Runner steps can read variables from the selected GitHub environment.
  # Export a fixed list only after checking the target and its identity.
  keys=(CMS_DEPLOY_PROJECT CMS_DEPLOY_PROJECT_NUMBER CMS_DEPLOY_REGION CMS_DEPLOY_IMAGE
        CMS_DEPLOY_SOURCE_BUCKET CMS_DEPLOY_BUILDER CMS_DEPLOY_ADMIN CMS_DEPLOY_SITE CMS_DEPLOY_WORKER
        CMS_DEPLOY_ADMIN_ORIGIN CMS_DEPLOY_SITE_ORIGIN CMS_DEPLOY_SCHEMA_REF)
  for key in "${keys[@]}"; do
    value="${!key:-}"
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail 'Release settings must be single-line values.'
  done
  for key in "${keys[@]}"; do
    printf '%s=%s\n' "$key" "${!key:-}"
  done >> "$GITHUB_ENV"
fi
printf 'Verified the project for the %s release.\n' "$CMS_RELEASE_TARGET"
