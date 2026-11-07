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

## Open canvas routes as documents

An HTML document sets the frame policy when it loads. Header and Footer
open that document directly. Page links from a site workspace also open it
directly when the authorized editor uses a different preview origin. Ordinary
page links stay in the current document so Back still opens the editor's
draft confirmation. The strict policy check and reload fallback still apply.

The browser checked one document request for the isolated editor, Header and
Footer, one Flight request in the ordinary editor, and the original Back
cancellation and draft-leave paths.
Five warm local samples per route for the original document trial, after the shared pool change:

| Route | Documents / RSC before | Documents / RSC after | Controls before (ms) | Controls after (ms) | Ready before (ms) | Ready after (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Header | 1 / 1 | 1 / 0 | 538 | 320 | 1433 | 1140 |
| Footer | 1 / 1 | 1 / 0 | 591 | 312 | 1412 | 1125 |
| Site look | 0 / 1 | 1 / 0 | 249 | 320 | 1099 | 1181 |
| Editor | 0 / 1 | 1 / 0 | 328 | 384 | 442 | 521 |

Header and Footer each went from 32 to 20 transactions and from 195 to
140 statements for the whole journey. The editor and Site look samples
started without a fallback reload on this fixture; their full document
loads were slower. The request-count gain applies to routes that previously
made both requests.

With the Back correction, the Editor fixture took 330 ms
to controls and 450 ms to ready in five warm samples. The median
request counts were 0 document and 1 Flight.

## Trim admin reads and keep navigation responsive

These are five warm local samples per route, compared with the document
navigation build. The journey includes previews and background requests. The
loader numbers count only the first admin document or Flight response, which
includes session work. They exclude preview, image and sidebar requests.

| Route | Controls before (ms) | Controls after (ms) | Loader transactions before → after | Loader statements before → after |
| --- | ---: | ---: | ---: | ---: |
| Home | 383 | 377 | 9 → 8 | 45 → 37 |
| Site overview | 242 | 189 | 11 → 10 | 59 → 50 |
| Pages | 186 | 145 | 9 → 8 | 49 → 40 |
| Header | 320 | 223 | 10 → 10 | 47 → 45 |
| Footer | 312 | 212 | 10 → 10 | 47 → 45 |
| Publishing | 278 | 281 | 14 → 14 | 91 → 85 |
| Editor | 384 | 410 | 19 → 19 | 81 → 81 |

The Header and Footer loader response medians were 196 → 99 ms and
194 → 98 ms. They read the normalized draft theme without computing its
usage. The page list reads one copy of each visible site's draft menu; the
role comparison returned the same ordered page props. A paired release
probe reduced SELECTs for page pins from 2,653 to 200 and for list
selections from 644 to 212. The Home review count no longer transmits full
review snapshots. One browser Lists save dropped from one action and one
extra Flight request to just the action. The saved row survived reload.

The progress bar reached its first visible frame in 13.2 ms and 13.8 ms
at 1440 px and 1024 px. Main segment loading screens were tried and held:
browser mutation timing found that Pages controls took 154 ms on pristine
and 335 ms with the fallback. Stories took 106 ms and 344 ms. With the
progress bar and without those segment fallbacks, the two measured clicks
took 120 ms and 104 ms. The editor retains a loading state on its document.

The editor still uses 19 transactions; the goal of eight is not met.
Two grouped read trials slowed one editor open and were held. The
six-transaction goal is also unmet on several workspaces. To check for
regressions against the measured work, run the budget check with the
private evidence directory containing `routes.json` and
`capture/requests.jsonl`:

```sh
node scripts/perf/check-loader-budgets.mjs "$PRIVATE/run-directory"
```

## Revalidate images before reading storage

Ten local authenticated image requests with matching ETags changed from
200 responses carrying 135,422 bytes total to
empty 304 responses. Ordinary requests still returned identical image
bytes, validators and content types, and anonymous requests still
returned 404. The median conditional request was
1.53 → 1.67 ms
on loopback; this removed transfer and storage work without measuring a
local latency win. Authorization still runs on every request. Tests
observe one storage read becoming zero on a matching validator.

Picker result thumbnails now defer loading where the browser can do so.
The Media grid keeps eager thumbnails because its intrinsic image sizes
affect computed styles before images load. The selected picker image
keeps its original loading behavior.

| Picker view | Width | Requests at open, before → after | Decoded after scrolling |
| --- | ---: | ---: | ---: |
| Grid | 1440 px | 48 → 48 | 48 |
| Grid | 1024 px | 48 → 48 | 48 |
| List | 1440 px | 48 → 48 | 48 |
| List | 1024 px | 48 → 48 | 48 |

The picker comparison used 48 distinct sample image URLs. The browser
was scrolled through the full result list. All 48 images decoded
after scrolling, at both widths.

The editor uses the progress bar on the outgoing screen. The route must
wait to send headers until it can return the correct status for an
unauthorized or missing page.

## Read the homepage preview through its owning page

The dashboard uses one indexed page/version lookup per site's homepage.
Both version pointers already have a foreign key that requires them to
belong to that page. The query still reads under the requesting user's role
and keeps the existing counts, preview choice and ordering.
The sidebar keeps its existing query until its own read changes.

All 15 role contexts returned the same ordered results. Five warm local SQL
samples went from 397 to 70 ms median. A larger local fixture returned all
60 rows in order and went from 11.78 to 0.31 s in three paired samples.
These measure SQL execution; they do not measure the hosted service.
