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
printf 'Verified the project for the %s release.\n' "$CMS_RELEASE_TARGET"
