#!/usr/bin/env bash
# Deploy an immutable app image to the three already-provisioned Cloud Run services.
set -Eeuo pipefail
umask 077

usage() {
  printf '%s\n' 'Usage: deploy-google-release.sh plan|build|deploy|rollback RELEASE_SHA RECEIPT_DIR' >&2
  exit 2
}
die() { printf 'Release stopped: %s\n' "$*" >&2; exit 1; }
[[ $# == 3 ]] || usage
mode="$1"
ref="$2"
out="$3"
case "$mode" in plan|build|deploy|rollback) ;; *) usage ;; esac
[[ "$ref" =~ ^[0-9a-f]{40}$ ]] || die 'Use the complete, tested Git commit.'
test "$(git rev-parse --verify "$ref^{commit}")" = "$ref" || die 'The commit is not present in this checkout.'
mkdir -p "$out"

project="${CMS_DEPLOY_PROJECT:?Set CMS_DEPLOY_PROJECT}"
project_number="${CMS_DEPLOY_PROJECT_NUMBER:?Set CMS_DEPLOY_PROJECT_NUMBER}"
region="${CMS_DEPLOY_REGION:?Set CMS_DEPLOY_REGION}"
image="${CMS_DEPLOY_IMAGE:?Set CMS_DEPLOY_IMAGE}"
services=("${CMS_DEPLOY_SITE:?Set CMS_DEPLOY_SITE}" "${CMS_DEPLOY_WORKER:?Set CMS_DEPLOY_WORKER}" "${CMS_DEPLOY_ADMIN:?Set CMS_DEPLOY_ADMIN}")
[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ && "$project_number" =~ ^[0-9]+$ && "$region" =~ ^[a-z]+(-[a-z0-9]+)+$ ]] ||
  die 'Check the project ID, project number and region.'
[[ "$image" == "$region-docker.pkg.dev/$project/"* && "$image" =~ ^[a-z0-9./_-]+$ ]] ||
  die 'The image must be in this project and region.'
for service in "${services[@]}"; do
  [[ "$service" =~ ^[a-z][a-z0-9-]{0,47}[a-z0-9]$ ]] || die 'Check each Cloud Run service name.'
done
[[ "${services[0]}" != "${services[1]}" && "${services[1]}" != "${services[2]}" && "${services[0]}" != "${services[2]}" ]] ||
  die 'Admin, site, and worker must be distinct services.'
cloud=(gcloud --quiet --project="$project")
[[ "$("${cloud[@]}" projects describe "$project" --format='value(projectNumber)')" == "$project_number" ]] ||
  die 'The project number does not match the configured project.'

service_json() { "${cloud[@]}" run services describe "$1" --region="$region" --format=json; }
revision_json() { "${cloud[@]}" run revisions describe "$1" --region="$region" --format=json; }
serving_revision() {
  service_json "$1" | jq -er --arg service "$1" --arg scope "$project_number" '
    select(.metadata.name==$service and .metadata.namespace==$scope)
    | [.status.traffic[] | select(.percent>0)]
    | select(length==1 and .[0].percent==100) | .[0].revisionName'
}
ready_revision() {
  revision_json "$2" | jq -ec --arg service "$1" --arg revision "$2" --arg scope "$project_number" --arg image "$image@" '
    select(.metadata.name==$revision and .metadata.namespace==$scope and
      .metadata.labels["serving.knative.dev/service"]==$service and
      (.status.imageDigest|startswith($image)) and
      any(.status.conditions[]; .type=="Ready" and .status=="True"))
    | {service:$service, revision:$revision, image:.status.imageDigest,
       version:([.spec.containers[0].env[]? | select(.name=="APP_VERSION") | .value][0])}
    | select((.version // "") | test("^[0-9a-f]{7,40}$"))'
}
runtime_settings() {
  revision_json "$1" | jq -ceS '
    .spec | del(.containers[0].image)
    | .containers[0].env = ([.containers[0].env[]? | select(.name!="APP_VERSION")] | sort_by(.name))'
}
health() {
  local service="$1" version="$2" role origin
  case "$service" in
    "${services[0]}") role=site; origin="${CMS_DEPLOY_SITE_ORIGIN:-}" ;;
    "${services[2]}") role=admin; origin="${CMS_DEPLOY_ADMIN_ORIGIN:-}" ;;
    *) return 0 ;; # Worker health is private; Ready is checked, never open it to the public.
  esac
  if [[ -z "$origin" ]]; then origin="https://$service-$project_number.$region.run.app"; fi
  [[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]] || die 'Health origins must be HTTPS origins without paths or credentials.'
  curl --fail --silent --show-error --max-time 45 --retry 2 "$origin/health" |
    jq -e --arg role "$role" --arg version "$version" '.status=="ok" and .role==$role and .version==$version' >/dev/null
}
capture_current() {
  local service current
  for service in "${services[@]}"; do
    current="$(serving_revision "$service")" || die "Require one serving revision for $service."
    ready_revision "$service" "$current" || die "The serving revision for $service is not Ready."
  done
}
schema_gate() {
  local schema_ref="${CMS_DEPLOY_SCHEMA_REF:-$1}"
  [[ "$schema_ref" =~ ^[0-9a-f]{7,40}$ ]] || die 'Set the verified applied schema commit.'
  git rev-parse --verify "$schema_ref^{commit}" >/dev/null || die 'The applied schema commit is missing; use a full checkout.'
  git diff --quiet "$schema_ref" "$ref" -- packages/schema/migrations ||
    die 'Migrations differ. Use the operator runbook, verify the backup and the applied schema, then set CMS_DEPLOY_SCHEMA_REF.'
}
route() {
  "${cloud[@]}" run services update-traffic "$1" --region="$region" --to-revisions="$2=100" --format=none
  [[ "$(serving_revision "$1")" == "$2" ]]
}

case "$mode" in
  plan)
    capture_current | jq -s '.' > "$out/serving.json"
    schema_gate "$(jq -er --arg name "${services[2]}" '.[]|select(.service==$name)|.version' "$out/serving.json")"
    printf 'Ready to deploy %s to three existing services.\n' "$ref"
    ;;
  build)
    bucket="${CMS_DEPLOY_SOURCE_BUCKET:?Set CMS_DEPLOY_SOURCE_BUCKET}"
    builder="${CMS_DEPLOY_BUILDER:?Set CMS_DEPLOY_BUILDER}"
    [[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]+$ && "$builder" =~ ^[a-z][a-z0-9-]+@$project\.iam\.gserviceaccount\.com$ ]] ||
      die 'Use the existing source bucket and a builder in this project.'
    owner="$("${cloud[@]}" storage buckets describe "gs://$bucket" --raw --format='value(projectNumber)')"
    [[ "$owner" == "$project_number" ]] || die 'The existing source bucket must belong to the target project.'
    git archive --format=tar.gz --output="$out/source.tar.gz" "$ref"
    jq -n --arg tag "$image:$ref" --arg buildarg "APP_VERSION=$ref" '
      {steps:[{name:"gcr.io/cloud-builders/docker",args:["build","--target=runtime",("--build-arg="+$buildarg),("--tag="+$tag),"."]}],
       images:[$tag],timeout:"2100s",options:{logging:"CLOUD_LOGGING_ONLY",machineType:"E2_STANDARD_2"}}' > "$out/build-config.json"
    "${cloud[@]}" builds submit "$out/source.tar.gz" --region=global --async --config="$out/build-config.json" \
      --gcs-source-staging-dir="gs://$bucket/submissions" --service-account="projects/$project/serviceAccounts/$builder" \
      --format='value(id)' > "$out/build-id.txt"
    build_id="$(cat "$out/build-id.txt")"
    [[ "$build_id" =~ ^[a-f0-9-]{36}$ ]] || die 'Cloud Build did not return a build ID.'
    for ((attempt=1; attempt<=110; attempt++)); do
      build="$("${cloud[@]}" builds describe "$build_id" --region=global --format=json)"
      case "$(jq -er '.status' <<<"$build")" in
        SUCCESS)
          digest="$(jq -er --arg project "$project" --arg tag "$image:$ref" '
            select(.projectId==$project) | .results.images[] | select(.name==$tag) | .digest' <<<"$build")"
          [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || die 'No valid image digest for the tested commit.'
          jq -n --arg ref "$ref" --arg image "$image@$digest" --arg build "$build_id" \
            '{ref:$ref,image:$image,build:$build}' > "$out/image.json"
          exit 0 ;;
        PENDING|QUEUED|WORKING) sleep 20 ;;
        *) die "Cloud Build $build_id failed." ;;
      esac
    done
    die "Timed out waiting for Cloud Build $build_id."
    ;;
  deploy)
    pinned="$(jq -er --arg ref "$ref" '. | select(.ref==$ref) | .image' "$out/image.json")"
    [[ "$pinned" == "$image@"* && "${pinned##*@}" =~ ^sha256:[a-f0-9]{64}$ ]] || die 'Use the image receipt for this commit and registry.'
    capture_current | jq -s '.' > "$out/previous.json"
    schema_gate "$(jq -er --arg name "${services[2]}" '.[]|select(.service==$name)|.version' "$out/previous.json")"
    suffix="g${ref:0:12}"
    for service in "${services[@]}"; do
      if candidate="$(ready_revision "$service" "$service-$suffix" 2>/dev/null)"; then
        jq -e --arg image "$pinned" --arg ref "$ref" '.image==$image and .version==$ref' <<<"$candidate" >/dev/null ||
          die "An existing revision with this name has a different image for $service."
      else
        "${cloud[@]}" run services update "$service" --region="$region" --image="$pinned" \
          --revision-suffix="$suffix" --update-env-vars="APP_VERSION=$ref" --no-traffic --async --format=none
      fi
    done
    for service in "${services[@]}"; do
      candidate=''
      for ((attempt=1; attempt<=30; attempt++)); do
        candidate="$(ready_revision "$service" "$service-$suffix" 2>/dev/null)" && break
        sleep 8
      done
      jq -e --arg pinned "$pinned" --arg ref "$ref" '.image==$pinned and .version==$ref' <<<"$candidate" >/dev/null ||
        die "The new revision for $service did not become Ready with the expected image."
      old="$(jq -er --arg name "$service" '.[]|select(.service==$name)|.revision' "$out/previous.json")"
      [[ "$(serving_revision "$service")" == "$old" ]] || die "Traffic changed while staging $service."
      previous_settings="$(runtime_settings "$old")"
      candidate_settings="$(runtime_settings "$service-$suffix")"
      [[ "$previous_settings" == "$candidate_settings" ]] || die "Runtime settings drifted for $service. Reconcile the serving revision and service template."
    done
    restore_on_failure() {
      local service old version current
      printf 'Deploy failed. Restoring traffic to the recorded revisions.\n' >&2
      for service in "${services[@]}"; do
        old="$(jq -er --arg name "$service" '.[]|select(.service==$name)|.revision' "$out/previous.json")"
        version="$(jq -er --arg name "$service" '.[]|select(.service==$name)|.version' "$out/previous.json")"
        current="$(serving_revision "$service")" || { printf 'Check %s traffic manually.\n' "$service" >&2; continue; }
        if [[ "$current" == "$service-$suffix" ]]; then
          route "$service" "$old" && health "$service" "$version" || printf 'Check %s rollback manually.\n' "$service" >&2
        elif [[ "$current" != "$old" ]]; then printf 'Unexpected revision on %s; left unchanged.\n' "$service" >&2
        fi
      done
    }
    trap 'status=$?; trap - EXIT; if ((status)); then restore_on_failure; fi; exit "$status"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    for service in "${services[@]}"; do
      if [[ "$(serving_revision "$service")" != "$service-$suffix" ]]; then
        route "$service" "$service-$suffix"
      fi
      health "$service" "$ref"
    done
    capture_current | jq -s '.' > "$out/deployed.json"
    trap - EXIT INT TERM
    ;;
  rollback)
    # Operator supplies the previous.json from the matching environment's deploy.
    test -s "$out/previous.json" || die 'Provide the prior release receipt.'
    capture_current | jq -s '.' > "$out/before-rollback.json"
    old_ref="$(jq -er '[.[].version] | unique | select(length==1) | .[0]' "$out/previous.json")"
    [[ "$old_ref" =~ ^[0-9a-f]{7,40}$ ]] || die 'The previous receipt needs one exact application version.'
    git rev-parse --verify "$old_ref^{commit}" >/dev/null || die 'The rollback version is missing from Git.'
    schema_ref="${CMS_DEPLOY_SCHEMA_REF:-$ref}"
    [[ "$schema_ref" =~ ^[0-9a-f]{7,40}$ ]] || die 'Set the verified applied schema commit.'
    git diff --quiet "$schema_ref" "$old_ref" -- packages/schema/migrations ||
      die 'This rollback crosses migration sets. Use the operator runbook for a compatibility review.'
    for service in "${services[@]}"; do
      old="$(jq -er --arg name "$service" '.[]|select(.service==$name)|.revision' "$out/previous.json")"
      [[ "$old" == "$service-"* && "$old" =~ ^[a-z0-9-]+$ ]] || die "Invalid rollback revision for $service."
      ready_revision "$service" "$old" | jq -e --arg name "$service" --slurpfile receipt "$out/previous.json" \
        '. as $rev | any($receipt[0][]; .service==$name and .==$rev)' >/dev/null ||
        die "The rollback receipt does not match the Ready revision for $service."
    done
    for service in "${services[@]}"; do
      old="$(jq -er --arg name "$service" '.[]|select(.service==$name)|.revision' "$out/previous.json")"
      version="$(jq -er --arg name "$service" '.[]|select(.service==$name)|.version' "$out/previous.json")"
      route "$service" "$old"
      health "$service" "$version"
    done
    capture_current | jq -s '.' > "$out/rolled-back.json"
    ;;
esac
