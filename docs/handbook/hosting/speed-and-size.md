# Review speed and Friday database size

For the maintainer and IT.
Baseline browser measurements below: November 5, 2026, on review build `6c20751`.

## Admin loads without controls or preview

A November 8 Chrome reload rendered Admin HTML but its JavaScript did not start.
Cloud Run returned 429 for 14 of the 22 JavaScript and CSS requests while the
single Admin instance was starting. The app never sent the preview request.
On the same image, raising Admin concurrency from 8 to 32 let all 22 requests
complete with HTTP 200. This removed the observed asset drops; the first burst
still took about 20 seconds. One warm Chrome reload opened the real preview in
1.79 seconds.

New manifests set Admin concurrency to 32. They still use zero warm instances,
at most one instance, one vCPU, and the same database pool and startup probe.
Existing services keep their settings on an image release. If an existing service
shows the same failure, compare the live settings and request logs before
changing it. Stage the same image on a revision with the updated concurrency,
verify the other settings match, then move traffic and repeat a fresh Admin
load. Restore traffic to the previous revision if the checks fail.
[Cloud Run explains the 429 response](https://docs.cloud.google.com/run/docs/troubleshooting#abort-request).

## Startup probe trial

A probe-only trial on a review Admin service used two-second checks and a
two-second timeout. A cold health request returned its first byte at 11.3 seconds
with the original probe. Two trials of the same image with the new probe took
22.3 and 21.7 seconds. Each measurement followed an idle window and the platform
logged a new instance. The trial was rolled back. These samples show what happened
on that service; they do not establish a general relationship between probe
frequency and Cloud Run cold starts.

Startup CPU boost stays off because [Google bills the additional allocated CPU](https://docs.cloud.google.com/run/docs/configuring/services/cpu).
Verify database connection usage per process before increasing either the
database pool size or the Admin instance limit.

## What was measured

Independent Playwright Chromium, signed in as the maintainer, without Chrome's debugging
banner. The copy/edit/save/reload/preview/publish flow used a temporary Education
copy outside the menu; retained content was unchanged. Times end at the visible
result: rendered heading/widget, enabled publish confirmation or final success
receipt. Waiting for a dialog to close is not publication success. Screenshots
were taken separately and are excluded from the timings. Header/Footer timings
wait for the iframe loading overlay to disappear, not merely for its document
to contain a header/footer. Earlier DOM-only 5.82/6.40s samples are superseded.
Both settled workspaces were inspected at 1440/1024; no failed requests observed.

| Step | Seconds |
| --- | ---: |
| Copy sector page and open its canvas | 7.43 |
| Edit heading and receive saved-draft confirmation | 1.33 |
| Reload the saved page and rendered canvas | 4.43 |
| Open saved visitor preview and rendered heading | 0.99 |
| Prepare publish review | 0.84 |
| Confirm publication through final success receipt | 1.83 |
| Reload Header workspace until preview is fully loaded/revealed | 6.78 |
| Open Footer workspace until preview is fully loaded/revealed | 6.73 |
| Reload World View through rendered widget | 2.80 |
| Open Split View through rendered widget | 3.90 |

These are single observed runs on the existing shared-core review database,
not medians, a load test or a guarantee. They include browser/network/application
work; they do not isolate SQL time or prove that changing tier produces a given
speedup. Earlier 41-second media authorization was addressed by migration 0205;
that historical observation is not the review environment’s measurement. The maintainer still needs
to walk the route in ordinary Chrome; an independent automated browser loading
successfully does not close the ordinary-browser preview-stall gate.

On Friday, repeat the slowest copy/open, Header/Footer and publish steps after
Super admin sign-in. Record the time to visible completion, exact build and database
tier. If a preview remains at Opening, or save/publish does not reach its final
receipt, stop that route and investigate before treating the deployment as ready.

## Hosted scheduling follow-up

On review2fd7c07, preparing a story/article release took about20s. The final
schedule POST took258.184s during bulk75-page/121-asset verification, then29.486s
with that verifier paused. The first walk used normal Chrome; the repeat used
independent Chromium, so the observations do not isolate the cause. Both completed
and were cancelled before running; neither QA record was published. Cancellation
was2.4s. Do not run bulk verification while timing the demo. Keep the approved
micro tier; scheduling under concurrent load remains a performance concern.

A read-only same-snapshot profile identified repeated site-wide shell/route/draft-
anchor reads for each of48pages. The narrow phase-scoped implementation reduces
those phases from46.23s/587queries to16.11s/305queries through the local SQL proxy,
with complete baseline and future-check results byte-identical. All48versions are
still rendered/checked per phase; facts are read fresh after trial publication.
The deployed fixaff04f7 was then walked in normal Chrome on the unchanged micro:
49pages checked, only the QA story/article selected, preparation POST11.588s and
final schedule POST12.814s (HTTP200, Cloud Run request latency). The success receipt
and pending Monday job were verified, then cancelled in3.072s with zero attempts;
both private QA records were archived. These are single server-request timings,
not medians or total user-perceived times. No bulk verifier ran during the recheck.
Scheduling remains in the route; allow about15s for each server step and wait for
its final receipt. Keep the approved micro tier.

## Friday choice and monthly cost

Use Cloud SQL PostgreSQL 16 Enterprise, zonal **`db-f1-micro`**, the smallest
shared-core tier and the same tier as the review copy. This is the maintainer’s
manager-approved test-phase budget of **about $10/month**. the review environment’s measured
save 1.3s, publish 1.8s and fully visible previews about 7s are acceptable for the
demo. The earlier 41-second case was fixed by **migration 0205**, not by increasing
server size. Keep the bootstrap's bounded pools and instance counts.

At 730 hours/month in `us-central1`, [Google Cloud SQL pricing](https://cloud.google.com/sql/pricing)
puts micro compute at `$0.0105/hour` (~$7.67/month). The bootstrap's 10 GiB SSD adds
~$1.70, so compute+disk is ~$9.37/month, before backup/transaction-log usage.
The agreed ~$10 is an estimate for this small database, not a hard billing cap;
Cloud Run, Storage, Hosting, builds and other services are separate. Shared-core
has no Cloud SQL SLA and public pages depend on the live database/service (G7);
that tradeoff is accepted for this test phase. The personal instance stays unchanged.

## Upgrade only if real editing is slow

After observing real use and obtaining budget approval, upgrade to
`db-custom-1-3840`: one dedicated vCPU, 3.75 GiB RAM and 10 GiB SSD, about **$51/month**
(~$49.31 compute+$1.70 disk at 730 hours, excluding backups/other services).
This is an available upgrade, not Friday's default or a measured speedup claim.

The maintainer runs this in the reviewed organization project. Save work, close
editing tabs, choose a maintenance window and take/verify a fresh backup first.
Use the exact instance in the reviewed bootstrap configuration:

```bash
TASK_SQL_INSTANCE=EXACT_INSTANCE_FROM_REVIEWED_CONFIG
bootstrap --phase verify --execute --owner-operated
gcloud sql instances describe "$TASK_SQL_INSTANCE" \
  --project="$TASK_PROJECT" --account="$TASK_ACCOUNT" \
  --format='table(name,settings.tier,state)'
gcloud sql instances patch "$TASK_SQL_INSTANCE" --cpu=1 --memory=3840MiB \
  --project="$TASK_PROJECT" --account="$TASK_ACCOUNT"
gcloud sql instances describe "$TASK_SQL_INSTANCE" \
  --project="$TASK_PROJECT" --account="$TASK_ACCOUNT" \
  --format='table(name,settings.tier,state)'
bootstrap --phase verify --execute --owner-operated
```

The [current CLI](https://docs.cloud.google.com/sdk/gcloud/reference/sql/instances/patch)
uses CPU/memory flags for dedicated Enterprise; the resulting tier is
`db-custom-1-3840`. It restarts the instance. Google documents **under 60 seconds
offline** for Enterprise CPU/memory changes, with the whole operation taking
several minutes. Reserve a **5–10 minute maintenance window** for checks; that
window is our planning allowance, not a downtime guarantee. Both CMS and public
pages may fail during the interruption. [Google's setting-change guidance](https://docs.cloud.google.com/sql/docs/postgres/instance-settings#impact_of_changing_instance_settings)

After RUNNABLE and successful verify, re-walk sign-in, save/preview/publish and
check worker/backup health. Update private config `sqlTier` to the approved new
tier and record timings/cost. This in-place resize keeps the same database/data;
never rerun initial restore over authored content. If rollback is needed, the
same administrator-run patch with `--tier=db-f1-micro` returns to micro and causes another
interruption; preserve a fresh backup and inspect the failed operation first.
