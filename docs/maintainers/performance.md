# Measuring CMS performance

Use a current production build and the same disposable fixture and media for
both sides of a comparison. Keep traces and raw fixture paths outside Git.
Use one browser run at a time. See [the verification gates](gates.md).

```sh
export GOLDEN_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/cms_e2e_refactor_perf
export E2E_ADMIN_PORT=3306 E2E_SITE_PORT=3307
node --experimental-strip-types scripts/perf/measure-routes.mjs \
  --out "$PRIVATE/run-1" --media-root "$FIXTURE_MEDIA" --result "$PRIVATE/before.json"
```

The runner warms each route once, then measures five journeys with two database
connections. It uses real links where the fixture exposes them, otherwise
document navigation. The first timing ends when the screen controls appear; the
ready timing includes the preview checks. Background traffic that outlasts
the sampling window is reported separately. Bundle gzip is measured on the
resources requested during that journey; pass `--document` for a fresh document
request on each route. It is not a report of the entire build directory.

The loopback fixture runner starts the ordinary Next.js CLI with an opt-in
request trace. The trace collects transaction counts, statements, connection
wait, query time, auth checks, outbound auth calls and the measured renderer
calls. Work may overlap, so total query and connection time can exceed one
request's wall time. Browser request records correlate by a generated trace ID.
If the browser closes a response early, its trace is marked incomplete.
Neither the trace nor the timing receipt stores cookies, SQL, user IDs or
request URLs. The normal server does not preload this tracer.

Run the save-and-navigation probe on a **separate** copy of the fixture, since
it writes a draft. Restore that copy between before and after measurements.

```sh
GOLDEN_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/cms_e2e_refactor_burst \
  node --experimental-strip-types scripts/perf/measure-burst.mjs "$PRIVATE/burst-1" "$FIXTURE_MEDIA"
```

The dashboard SQL baseline on the review fixture, measured as the authenticated
database role with a super admin actor, was 371.7 ms median across five warm
executions with `track_functions=all`. A representative execution made 24,870
shared buffer hits and 1,287 calls to `has_page_access`. Query work measured on
this machine is distinct from hosted response time.

## Local route baseline

Five warm samples per route. The work columns include requests initiated by the journey, such as switcher, inbox, thumbnails and previews. They are not counts for the route loader alone.

| Route | Controls (ms) | Ready (ms) | Top-level documents | RSC | Transactions | Statements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Home | 382 | 413 | 1 | 0 | 19 | 85 |
| All sites | 352 | 375 | 0 | 3 | 5 | 20 |
| Site overview | 242 | 1046 | 0 | 1 | 15 | 75 |
| Pages | 185 | 996 | 0 | 1 | 13 | 65 |
| Stories | 131 | 967 | 0 | 1 | 80 | 323 |
| Story editor | 220 | 249 | 0 | 1 | 9 | 41 |
| Media | 411 | 1246 | 1 | 0 | 59 | 246 |
| Lists | 175 | 1014 | 0 | 1 | 80 | 322 |
| Header | 468 | 1359 | 1 | 1 | 32 | 195 |
| Footer | 518 | 1337 | 1 | 1 | 32 | 195 |
| Site look | 236 | 1096 | 0 | 1 | 61 | 258 |
| Publishing | 280 | 1086 | 0 | 1 | 18 | 107 |
| People | 353 | 381 | 0 | 1 | 6 | 24 |
| Inbox | 60 | 83 | 0 | 1 | 6 | 24 |
| Editor | 314 | 434 | 0 | 1 | 38 | 164 |

## Bound the database connection wait

Two independently loaded server modules previously opened four authenticated
connections at a configured limit of two. The process now shares the two
connections, without merging database roles. An exhausted original pool was
still waiting after 16 seconds; the new checkout timed out in 15.001 seconds.
After the test closed an idle connection, the pool opened a replacement.
Long-running statements still have no new timeout.

These warm local journeys show the cost of enforcing the configured limit:
Site overview, Header and Footer waited longer for connections. The change
bounds a stalled checkout and avoids multiplying the connection count; it
does not make those individual screens faster. Connection wait is summed
across concurrent journey requests and can exceed elapsed screen time.

| Route | Controls before (ms) | Controls after (ms) | Connection wait before (ms) | Connection wait after (ms) |
| --- | ---: | ---: | ---: | ---: |
| Home | 382 | 376 | 202 | 202 |
| All sites | 352 | 364 | 0 | 0 |
| Site overview | 242 | 337 | 190 | 622 |
| Pages | 185 | 185 | 77 | 75 |
| Stories | 131 | 133 | 216 | 188 |
| Story editor | 220 | 226 | 1 | 1 |
| Media | 411 | 412 | 141 | 138 |
| Lists | 175 | 179 | 297 | 294 |
| Header | 468 | 538 | 552 | 1040 |
| Footer | 518 | 591 | 575 | 1048 |
| Site look | 236 | 249 | 468 | 464 |
| Publishing | 280 | 280 | 23 | 21 |
| People | 353 | 353 | 3 | 3 |
| Inbox | 60 | 60 | 2 | 4 |
| Editor | 314 | 328 | 1136 | 1159 |
