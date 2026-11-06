#!/bin/sh
# Offline packaging checks. No database, cloud provider or user account is used.
# CONTAINER_ENGINE may name docker, podman, or an executable wrapper for a
# task-specific connection. Both images must already have been built.
set -eu
engine=${CONTAINER_ENGINE:-docker}
ordinary=${1:-cms-v2:verify}
recovery=${2:-cms-v2-recovery:verify}
temporary=$(mktemp -d)
containers=''
cleanup() {
  for name in $containers; do "$engine" rm -f "$name" >/dev/null 2>&1 || true; done
  rm -rf "$temporary"
}
trap cleanup 0 HUP INT TERM

"$engine" run --rm --network none --entrypoint sh "$ordinary" -ec '
  test "$(id -u)" -ne 0
  node -e "if(process.versions.node.split(\".\")[0]!==\"24\"||!process.env.APP_VERSION)process.exit(1);console.log(JSON.stringify({node:process.version,appVersion:process.env.APP_VERSION,uid:process.getuid()}))"
  test -w /data/media
  test -w /app/apps/admin/.next/cache
  test -w /app/apps/site/.next/cache
  test ! -e /app/.env
  test ! -e /app/e2e/test-results
'

# Running the actual entrypoints offline catches missing TS workspace links,
# import-only APIs and accidental package-manager downloads that grep cannot.
for role in migrate drain seed; do
  if "$engine" run --rm --network none "$ordinary" "$role" >"$temporary/$role.log" 2>&1; then
    echo "$role unexpectedly succeeded without a database credential" >&2; exit 1
  fi
  if ! grep -q 'DATABASE_URL' "$temporary/$role.log"; then cat "$temporary/$role.log" >&2;exit 1;fi
  printf '%s\n' "$role: starts offline and refuses missing credentials"
done
set +e
"$engine" run --rm --network none "$ordinary" invalid-role >"$temporary/invalid.log" 2>&1
status=$?
set -e
test "$status" -eq 64

for role in admin site worker; do
  name="cms-v2-smoke-$$-$role"
  containers="$containers $name"
  case "$role" in admin) port=3000;expected=503;;site) port=3001;expected=503;;worker) port=3002;expected=200;;esac
  "$engine" run --detach --network none --name "$name" \
    --env DATABASE_URL_WORKER=postgres://smoke:invalid@127.0.0.1:1/unavailable \
    "$ordinary" "$role" >/dev/null
  if ! "$engine" exec "$name" node -e '
    (async()=>{
      for(let attempt=0;attempt<40;attempt++){
        try {const r=await fetch(`http://127.0.0.1:${process.argv[1]}/health`);if(r.status!==Number(process.argv[2]))throw new Error(`Unexpected status ${r.status}`);console.log(`HTTP ${r.status}: packaged role is reachable`);return}
        catch(error){if(attempt===39)throw error;await new Promise(resolve=>setTimeout(resolve,500))}
      }
    })().catch(error=>{console.error(error.message);process.exit(1)})
  ' "$port" "$expected"; then "$engine" logs "$name" >&2;exit 1;fi
  "$engine" stop --time 10 "$name" >/dev/null
  "$engine" rm "$name" >/dev/null
  containers=$(printf '%s' "$containers" | sed "s/ $name//")
done

# The same launcher used by the worker must produce a real PNG as nonroot,
# using the browser already present in the image and without network access.
"$engine" run --rm --network none --workdir /app/apps/worker --entrypoint node "$ordinary" \
  --experimental-strip-types --input-type=module -e '
    import {createScreenshotter,readConfig} from "./src/config.ts";
    const capture=createScreenshotter(readConfig());
    try {
      const result=await capture.capture({html:"<!doctype html><html><body><h1>Offline image check</h1></body></html>",viewport:{width:320,height:200}});
      if(result.fidelity!=="rendered"||result.png.length<100||result.png[0]!==137)throw new Error("No rendered PNG produced");
      console.log(JSON.stringify({browser:"Chromium",fidelity:result.fidelity,bytes:result.png.length}));
    } finally {await capture.close()}
  '

"$engine" run --rm --network none --entrypoint sh "$recovery" -ec '
  test "$(id -u)" -ne 0
  node -e "if(process.versions.node.split(\".\")[0]!==\"24\"||!process.env.APP_VERSION)process.exit(1);console.log(JSON.stringify({node:process.version,appVersion:process.env.APP_VERSION,uid:process.getuid()}))"
  pg_dump --version | grep " ${CMS_POSTGRES_MAJOR:-17}\."
  pg_restore --version | grep " ${CMS_POSTGRES_MAJOR:-17}\."
  mkdir /tmp/cms-empty-inventory
  node --experimental-strip-types src/recovery-cli.ts inventory /tmp/cms-empty-inventory
'
printf '%s\n' 'Offline ordinary/recovery image smoke checks passed.'
