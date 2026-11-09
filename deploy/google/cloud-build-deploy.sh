#!/usr/bin/env bash
# Steps for deploy/google/cloudbuild-deploy.yaml, the push-to-main Cloud Build trigger.
# It stages Site, Worker and Admin without traffic, routes each in turn, checks
# /health for this commit and restores the recorded revisions on any failure.
# A changed migration set stops the build before anything is built or routed.
set -Eeuo pipefail

die() { printf 'Release stopped: %s\n' "$*" >&2; exit 1; }
: "${COMMIT_SHA:?}" "${PROJECT_ID:?}" "${REGION:?}" "${IMAGE:?}" "${SITE:?}" "${WORKER:?}" "${ADMIN:?}"
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Run this from a Git trigger so COMMIT_SHA is the full commit.'
services=("$SITE" "$WORKER" "$ADMIN")
state=/workspace/release
mkdir -p "$state"
cloud=(gcloud --quiet --project="$PROJECT_ID")

# The slim Cloud SDK image has no system python3; gcloud always bundles one.
python() {
  [[ -n "${PYTHON:-}" ]] || PYTHON="$(command -v python3 || gcloud info --format='value(basic.python_location)')"
  "$PYTHON" "$@"
}
json_field() { python -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {}, {'d': d}))" "$1"; }

serving_revision() {
  "${cloud[@]}" run services describe "$1" --region="$REGION" --format=json | json_field \
    "(lambda t: t[0]['revisionName'] if len(t)==1 and t[0]['percent']==100 else '')([x for x in d['status']['traffic'] if x.get('percent')])"
}
revision_image() {
  "${cloud[@]}" run revisions describe "$1" --region="$REGION" --format=json | json_field "d['status']['imageDigest']"
}
service_url() {
  "${cloud[@]}" run services describe "$1" --region="$REGION" --format='value(status.url)'
}
healthy() {
  local service="$1" version="$2" role
  case "$service" in
    "$SITE") role=site ;;
    "$ADMIN") role=admin ;;
    *) return 0 ;; # Worker health stays private; Ready is checked by the update.
  esac
  # Python, not curl: the step image guarantees only gcloud and its bundled Python.
  python - "$(service_url "$service")/health" "$role" "$version" <<'PY'
import json, sys, time, urllib.request
url, role, version = sys.argv[1:]
for attempt in range(4):
    try:
        with urllib.request.urlopen(url, timeout=45) as response:
            d = json.load(response)
        sys.exit(0 if d.get('status') == 'ok' and d.get('role') == role and d.get('version') == version else 1)
    except (OSError, ValueError):
        time.sleep(5)
sys.exit(1)
PY
}
route() {
  "${cloud[@]}" run services update-traffic "$1" --region="$REGION" --to-revisions="$2=100" --format=none
}

case "${1:-}" in
  live-image)
    # Record what is serving now; the guard and any restore use this receipt.
    : > "$state/previous.txt"
    for service in "${services[@]}"; do
      revision="$(serving_revision "$service")"
      [[ -n "$revision" ]] || die "$service must serve one revision at 100%."
      version="$("${cloud[@]}" run revisions describe "$revision" --region="$REGION" --format=json | json_field \
        "next((e.get('value','') for e in d['spec']['containers'][0].get('env',[]) if e['name']=='APP_VERSION'), '')")"
      printf '%s %s %s\n' "$service" "$revision" "${version:-unknown}" >> "$state/previous.txt"
    done
    revision_image "$(serving_revision "$ADMIN")" > "$state/live-image.txt"
    cat "$state/previous.txt"
    ;;
  migration-guard)
    # Migrations run separately. Never ship code ahead of the applied schema.
    live="$(cat "$state/live-image.txt")"
    docker run --rm --entrypoint sh "$live" -c 'cd /app/packages/schema/migrations && LC_ALL=C sha256sum -- *' > "$state/live.sha"
    (cd packages/schema/migrations && LC_ALL=C sha256sum -- *) > "$state/new.sha"
    if ! diff -u "$state/live.sha" "$state/new.sha"; then
      die "Migrations differ from the live image. Run the migrate job against production, then re-run this build."
    fi
    echo 'Migration set matches the live image.'
    ;;
  push)
    docker push "$IMAGE:$COMMIT_SHA"
    docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE:$COMMIT_SHA" > "$state/image.txt"
    [[ "$(cat "$state/image.txt")" =~ ^"$IMAGE"@sha256:[0-9a-f]{64}$ ]] || die 'No pinned image digest for this commit.'
    cat "$state/image.txt"
    ;;
  deploy)
    pinned="$(cat "$state/image.txt")"
    suffix="g${COMMIT_SHA:0:12}"
    for service in "${services[@]}"; do
      if existing="$(revision_image "$service-$suffix" 2>/dev/null)"; then
        [[ "$pinned" == "$existing" ]] ||
          die "$service-$suffix already exists with a different image."
      else
        "${cloud[@]}" run services update "$service" --region="$REGION" --image="$pinned" \
          --revision-suffix="$suffix" --update-env-vars="APP_VERSION=$COMMIT_SHA" --no-traffic --format=none
      fi
    done
    restore() {
      local service revision version
      printf 'Deploy failed. Restoring the recorded revisions.\n' >&2
      while read -r service revision version; do
        [[ "$(serving_revision "$service")" == "$revision" ]] && continue
        route "$service" "$revision" && healthy "$service" "$version" ||
          printf 'Check %s traffic manually.\n' "$service" >&2
      done < "$state/previous.txt"
    }
    trap 'status=$?; trap - EXIT; ((status)) && restore; exit "$status"' EXIT
    for service in "${services[@]}"; do
      route "$service" "$service-$suffix"
      healthy "$service" "$COMMIT_SHA" || die "$service did not report $COMMIT_SHA on /health."
      printf '%s now serves %s\n' "$service" "$service-$suffix"
    done
    trap - EXIT
    ;;
  *)
    die 'Usage: cloud-build-deploy.sh live-image|migration-guard|push|deploy'
    ;;
esac
