# Threat model

Covers the security contract of [SPEC revision 7 §8](archive/SPEC-r7-2026-10-11.md#8-security-contract),
which still applies under revision 8 (SPEC §15). "SPEC §N" references in this file and in code use
revision 7's numbering.

Reviewed at M1. Reviewed again before raw HTML ships to any non-super-admin
surface, and before the first external tenant.

Each entry names the boundary that stops it and the test that proves the
boundary exists. An entry with no test is listed as **not yet covered** rather
than assumed.

## 1. Anonymous visitor reaching non-public data

**Stopped by:** `cms_public_renderer` holds `USAGE` on `public_api` only and
`EXECUTE` on three functions. It has no `USAGE` on `public`, so it cannot name
an authoring table (ADR 0002).
**Proved by:** `isolation.db.test.ts` — "cannot name an authoring table at all",
across seven tables, plus the projection tables themselves.

## 2. Contributor escalating privilege

**Stopped by:** capability tiers evaluated in the database
(`app.can_publish`, `app.can_administer_site`); `site_memberships` and
`global_roles` carry no application DML grant; membership changes are commands
that re-derive the actor from session context.
**Proved by:** `tenancy.db.test.ts` — contributor cannot publish or create
pages, editor cannot create sites, self-granted membership and self-granted
super-admin rows are both refused.
**Known sharp edge:** the application role can `SET app.user_id` to any value,
so a SQL-injection foothold in the admin app is an impersonation foothold. The
mitigation is parameterized queries everywhere plus the fact that all writes go
through commands. This is the same trust shape as Supabase's JWT claims GUC.

## 3. Compromised editor account

**Stopped by:** every write is a command that writes audit in the same
transaction; publication requires the current revision; raw markup requires a
separate super-admin approval; audit cannot be edited or deleted by any
application role.
**Proved by:** `publication.db.test.ts`, `isolation.db.test.ts` (audit
immutability, including against a privileged session).
**Not yet covered:** recent-auth re-checks for sensitive operations, and rate
limiting on sign-in. Both are M3.

## 4. Hostile stored content

**Stopped by:** one policy package with several enforcement points — text slots
escaped, rich text against a closed allowlist, URLs scheme-checked, CSS
tokenized/scoped/property-checked, and authored section source compiled to a
checked AST at authoring time. Public rendering does not reparse authored
source, but some site-specific presentation steps (report, story and Echelon
layouts) adjust the already-sanitized output with string replacements or a
re-parse of rendered HTML. Those steps must only add classes, attributes and
fixed markup, and any editor text they reuse must stay escaped; review them
with the same care as the sanitizer. Public pages carry only
fixed, application-owned scripts (navigation, chapter directory, story widgets,
hero slides, chart fullscreen, FAQ and schedule filters) allowed by exact
hashes, plus a site's own reviewed script files.
**Proved by:** `packages/renderer/src/security.test.ts` — 42 cases including
`javascript:` with embedded control characters, protocol-relative URLs,
`data:` URLs, `@import`, off-site `url()`, `expression()`, unknown tags
carrying event handlers, and unbalanced markup.

## 5. Trusted-code bypass

**Stopped by:** three independent layers. `carries_trusted_code` is recomputed
server-side from the payload on every save; `publish_page` refuses an unapproved
version with `CMS05`; and a database trigger refuses any `published_version_id`
pointing at unapproved raw markup, including from the owner role.
**Proved by:** `publication.db.test.ts` — a client-supplied flag is ignored, an
editor cannot self-approve, and the owner's direct `UPDATE` is refused.

## 6. Cross-tenant host or cache confusion

**Stopped by:** `normalizeHost` refuses anything that is not one plain lowercase
hostname; routing matches verified domains and staging hostnames only, with no
default-site branch anywhere; forwarded headers are believed only when
`TRUST_PROXY_HEADERS` says a proxy is in front; cache keys and ETags include
tenant, path, published version, and shell revision.
**Proved by:** `hostname.test.ts` (hostile corpus), `public-contract.db.test.ts`
(unknown host, host with userinfo, path traversal in Host, one tenant's path on
another tenant's host).

## 7. Replayed or concurrent publication

**Stopped by:** the head row is locked and its revision compared inside the
publication transaction, then advanced.
**Proved by:** `publication.db.test.ts` — two concurrent publishes at the same
revision produce one success, one `CMS01`, and exactly one audit row.

## 7a. Publishing through a path that skips the readiness gate

SPEC §6.8 requires the same readiness policy on every publish path, and says the
same invalid draft is refused from editor, review, bulk, and schedule. The
scheduler did not honour it: `execute_scheduled_action` passed a hard-coded
policy version and an empty `{}` report, and the worker never ran the checks. A
version the editor refused — no H1, no sections, an image with no description, a
link to a page that does not exist — published fine on a timer. Anyone who could
create a schedule could publish content the editor would not let them publish.

**Stopped by:** one shared evaluation and one database gate (migration 0010).
`@cms/platform`'s `evaluateVersionReadiness` is the only implementation, called
by the admin publish action and by the worker, always against the *immutable
pinned version* rather than the current draft. `app.assert_publishable` then
refuses, in the database, any publication carrying blocking findings without an
override reason, and refuses a report that is not a findings array — `{}` is not
read as "nothing wrong", because that is the shape produced when nobody checked.
A schedule pins `readiness_policy_version` at creation and a worker evaluating
under a different version is refused rather than judging the page by the wrong
rules. There is no scheduling override model, so blocking findings end the
schedule, permanently, with the rules listed in `last_error` and the report kept
on the row. Publication and settlement remain in one transaction.

`app.publish_page` carries no readiness defaults (0011): the two-argument form
that published while asserting "the checks found nothing" no longer resolves, so
a caller that has not been updated fails at 42883 rather than publishing under an
assumption nobody made. Every finding is validated as well — an object, a
non-empty rule, a severity that is exactly `blocking` or `advisory`, a non-empty
message — because `[{}]` and `[1]` contain no blocking findings only in the sense
that they contain no findings, and a malformed report that reads as clean is
worse than an absent one.

**What this does not prove.** The database cannot establish that the findings it
was handed are the ones the TypeScript evaluator would produce for that version;
the rules need a rendered page. It proves that a report was explicitly supplied,
that its policy version and structure are valid, and that declared blocking
findings require an override — and, independently of any report, that
authorization, the pinned version's ownership, trusted-code approval, the
revision CAS, audit, the public projection, and atomicity hold. The rest of the
boundary is placement, not proof: the admin server, the worker, and the seed all
compute the report with the shared module, and the browser never holds a
database credential and never supplies a report. A compromised admin server or
worker could assert a clean report — it already holds a credential that can
publish — which is why those two are inside the trust boundary and the browser
is not.

**Proved by:** `scheduled-readiness.db.test.ts` — the editor's evaluation and the
worker's reach the same verdict on the same version; the editor is refused; the
schedule is refused and leaves revision, projection, audit, and outbox untouched;
`{}`, a null report, a mismatched policy version, a blank override reason, and
thirteen shapes of malformed finding are each refused, on both the editor's path
and the scheduler's. `publication.db.test.ts` proves the two-argument call no
longer resolves and that no overload carries a readiness default.

## 4a. Contextual injection through a section template

A section template is authored HTML with `{{slot}}` tokens in it, and a slot can
sit anywhere. Sanitizer policy 1 recorded nothing about where, so the renderer
escaped every value the same way — with the element-text escaper, which does not
escape quotes. That is the wrong escaper for an attribute, the wrong policy for
a URL, and no protection at all for a structural position. Reproduced:

| Template | Value | Was emitted |
|---|---|---|
| `<div {{value}}>x</div>` | `onclick=alert(1)` | `<div onclick=alert(1)>x</div>` |
| `<a href="{{value}}">go</a>` | `javascript:alert(1)` | a live `javascript:` URL |
| `<div style="{{value}}">x</div>` | `background:url(//evil.test/x)` | a request to another server on every view |
| `<{{value}}>x</div>` | `script` | `<script>` |
| `<div {{value}}="x">y</div>` | `onclick` | an event handler |
| `<div title={{value}}>x</div>` | `a onclick=alert(1)` | an event handler, because a space ends an unquoted value |

**Stopped by:** a sink model rather than a boolean (policy 2, `context.ts`). An
HTML tokenizer walks the template at compile time and records, per slot, which
of eleven positions it occupies. Four are renderable, each with its own escaper:
element text, quoted attribute, URL attribute (through the URL policy), style
attribute (through the CSS policy). The other seven — event handler, `srcdoc`,
unquoted value, attribute name, tag name, comment, raw text — cannot be escaped
into safety and are refused at compile time, refused again by the database
(migration 0012), and render as nothing if one ever reaches the renderer anyway.
Markup-emitting slot kinds are confined to element text in every case.

**Proved by:** `contextual-injection.test.ts` names every reproduction, and
`sanitizer-in-browser.spec.ts` puts the rendered result into a live Chromium
document and asserts through the DOM — no script elements, no event handlers, no
executable URL by the browser's own resolution, no external request, no dialog —
for every corpus payload in every sink, on both the preview and public paths.
Deliberately with no CSP on those documents: CSP is defence in depth and belongs
in front of the app, and using it here would let a sanitizer bypass pass.

**A declared context is not evidence.** The first version of this recorded each
slot's sink and then believed it, which made the record a claim the row got to
make about itself — and a row is something a migration, a restore or a hand edit
can write. Contexts are re-derived from the node list on every render, paired
positionally so two uses of one slot id cannot collapse into one answer, and a
declared context that disagrees with the derived one is blocking.

**Stored values are never syntax.** A slot id used to be interpolated into the
marker that reconstruction re-scans, which made an id an input to a parser: one
containing `}}</p><div title="` rewrote where every later slot appeared to sit.
Ids are a narrow grammar now, and reconstruction uses generated positional
markers that owe nothing to stored data — compared on count, offset, identity
and length, with an html node carrying such a marker refused outright.

**Scripts and slots do not mix.** HTML's script-data escaped and double-escaped
states mean an apparent `</script>` sometimes closes the element and sometimes
does not, so a slot after one was classified as text and executed. The scanner
treats script as one-way and the compiler refuses any template containing both a
script and a slot. Approval remains a decision about static markup; it cannot
turn a data slot into code. See ADR 0006 for why this kept happening.

*Whether* there is a script is no longer a question for the scanner. Inside
`<svg>` and `<math>` the raw-text elements are not raw text — Chromium runs the
script in `<svg><title><script>…</script></title>`, and in `<svg><style>`,
`<svg><textarea>`, `<svg><xmp>` and `<math><mtext>` too — so a walk that treats
`title` as raw text everywhere never saw one, and a template could carry a
script *and* slots past the rule. Agreeing with the parser here would mean
implementing HTML's foreign-content algorithm including its integration points,
where `<math><mi><title>` is HTML again and the script really is inert. The rule
does not need to know where a script is, only that there is one, so the test is
now a blunt search of the markup the AST carries — the same one
`app.render_ast_defect` performs on the same concatenated values, so the
compiler and the storage gate refuse exactly the same templates. It is
deliberately over-strict: a literal `<script` inside a comment or a `<title>` is
inert and refused anyway.

**Why no sanitizer policy bump came with this.** The compiler now refuses
templates it used to accept, which normally means the version has to move so
stored artifacts are re-derived. It does not here, and the reason is worth
writing down: `app.render_ast_defect` was *already* applying the state-free
script search to the same concatenated html values, so no artifact that is
stored could ever have been one of the newly-refused ones. The change moved the
refusal earlier and gave it a better message; it did not change which stored
ASTs are valid. Bumping would have forced a fleet-wide revalidation whose only
effect is to recompute identical bytes. The same reasoning does not extend to
the *scanner* fixes: those change derived contexts, and the renderer re-derives
on every request and fails closed, which is how a stale row is caught.

**Approval has to see what a browser sees.** `ACTIVE_MARKUP` decides
`carries_trusted_code`, which is the input to the publish gate — so anything it
misses ships with no super-admin review at all. It required whitespace before an
event handler, and HTML accepts a solidus wherever it accepts whitespace between
attributes: `<img/onerror=…>` was, to this gate, inert markup, and Chromium
normalises it back into a live handler. It also had no opinion on `vbscript:`,
which the CSS policy has always refused — the same scheme was active markup in a
stylesheet and unremarkable in a template, and static markup never passes
through `safeUrl`. Both are closed, and the malicious-corpus suite no longer
uses a copy of this regex as its own oracle, because an oracle copied from the
thing it checks agrees with it by construction.

**A URL policy has to know whether it is holding a list.** `srcset`, `ping` and
`archive` carry several URLs, and `safeUrl` answers about one. It also stripped
every space in its input, which welded a list into a single string — so
`/a.png 1x, //evil.test/x.png 2x` became one value beginning with `/`, passed
the protocol-relative check as same-site, and was split back into two candidates
by the browser, one of them off-site. Control characters are still removed
before the scheme test, because the URL parser removes them too; spaces are not,
because a space cannot invent a scheme. List attributes are checked per URL, and
one bad entry refuses the whole value rather than being dropped quietly.
Five of the attributes in that set are not URLs at all — `xmlns` and
`xmlns:xlink` choose a namespace, and `from`, `to` and `values` are SMIL
animation values — so a slot in one renders nothing rather than teaching this
policy a fourth grammar for a case the catalogue does not contain.

**Neighbouring sinks drift apart.** Three did. `meta.canonical` was emitted with
no URL policy while `og:image` two lines below it had one, so a
protocol-relative canonical handed the page's identity to another host;
`safeUrl` refused `//host` but not `/\host`, which the URL parser resolves to
the same place because a backslash is a slash in the authority position; and
`hidden_at` entries were escaped and then concatenated into the section's class
attribute, so one array element could add three class names of the author's
choosing and borrow another definition's styles. Each is now the same shape as
the neighbour it drifted from: the URL policy, the URL policy, and an allowlist
of the three breakpoints the stylesheet actually has.

**A selector's meaning is not in its characters.** `.cms-section--d\65 vil` is
the class `cms-section--devil`; a prefix-and-boundary test read the backslash as
a boundary and let one definition style another's sections. Comments and
every-character escaping did the same, and `&\65 vil` let authored CSS *produce*
it, because scoping was string replacement next to author-chosen characters.
Selectors are parsed now — identifiers compared, scope inserted as a node, the
result re-parsed before it ships — and a slug has a grammar in Zod, TypeScript
and SQL so it cannot become selector syntax on the way to a class name.

**Compiled artifacts are validated, not believed.** A `css_policy_version`
column is a claim. `validateCompiledCss` re-checks the artifact with PostCSS and
the CSS value tokenizer — every selector branch rooted at that definition's own
scope with a real boundary, at every nesting level, with declarations re-run
through the URL policy — and the renderer drops the section if it fails. The SQL
gate is strengthened to the same shape as far as SQL honestly goes, which is
structural only: it has no tokenizer, so it can refuse what is definitely wrong
and cannot confirm what is right.

**What the database can and cannot check.** It validates structure, both policy
versions, that every slot names a context from the known set, and that a
markup-emitting slot is not in an attribute. It cannot check that a declared
context is the one a tokenizer would agree with — that needs the tokenizer,
which lives in the renderer, which is why the renderer re-derives rather than
trusting what it was handed. The boundary is the same one readiness has (§7a):
the trusted server compiles, the database checks what structure allows, the
renderer re-checks everything it depends on, and no browser supplies any of it.

## 4b. Reassigning a page's identity through canonical metadata

A canonical link is the one element in the head that does not describe the page
— it says which address *is* this document, and every search engine acts on it.
So `meta.canonical: 'https://evil.test/x'` is not a malformed value to be
escaped; it is a well-formed URL, correctly quoted, asking the whole index to
credit another host with this page's content and to stop indexing ours. The URL
policy could not answer this, and was never meant to: `safeUrl` decides whether
a scheme can execute, and passes every absolute `https:` URL. Audit finding R-08
closed the scheme half and left this half open on purpose, because restricting
canonical to the site's own host is a product decision rather than a defect fix.
That decision is now made (SPEC §6.8): ordinary canonical metadata is same-site.

**Stopped by:** `packages/renderer/src/canonical.ts`, on the one rendering path
every publish surface uses. A relative canonical resolves against the page's own
address; an absolute one is accepted only when its normalized hostname equals
the site's verified `canonical_host`. Every comparison is made on values the
WHATWG URL parser produced, and hostnames are compared for equality — never a
prefix or suffix test, which is how `example.test.evil.test` passes a check
written for `example.test`. `:443` is dropped as https' own default and any
other port is a different origin; case, a trailing dot, and Unicode against
punycode are normalized to one spelling, so a site is never refused its own
address. A refused value is replaced by the page's own address and is never
emitted, in either `<link rel="canonical">` or `og:url` — which is what stops
this being an escaping problem with a silent failure mode.

The staging half is the same rule read the other way: a staging render names the
verified live URL whenever the site has one, rather than the host it arrived on.
A canonical pointing at a hostname that is deliberately `noindex` and is going to
be turned off is not a lesser problem than one pointing at an attacker.

**Proved by:** `packages/renderer/src/canonical.test.ts` — protocol-relative,
backslash-authority, `http:`, `mailto:`, `tel:`, `javascript:` (including split
by a control character), `data:`, embedded credentials, a non-default port, an
IP literal, a malformed URL, and the two deceptive-suffix hosts are each
refused; explicit `:443`, case, trailing dot, and Unicode/punycode are each
accepted as the same host; a staging render with a live domain names the live
URL and still says `noindex`. `swarm-findings.test.ts` keeps R-08's original
reproductions. `sanitizer-in-browser.spec.ts` proves a hijacked canonical
reaches no browser.

**Not yet covered.** The author is not *told*. SPEC §6.8 lists `invalid
canonical host` among the blocking readiness rules and it is the one rule on
that list `runReadinessChecks` does not implement, because the refusal cannot be
read back out of the rendered page — the refused value is gone by then, replaced
by the site's own address. `renderPage` now returns `PageDocument.canonical`,
carrying the rule, the plain-language message, and the value the author wrote,
so the check is a wiring change in `@cms/platform` rather than a redesign; it
lands with the readiness policy version bump, since `readiness_policy_version`
is pinned into `scheduled_actions` at schedule creation (§7a). Until then the
guarantee is the categorical one — nothing external is published on any path —
without the actionable one.

Cross-domain canonical is a real syndication feature and is not built. SPEC §6.8
records the five things it will require before it is: super-admin permission, an
explicitly allowed *and verified* external host, a stated reason, an audit event,
and invalidation of the approval when the canonical changes.

## 8. Upload abuse

**Stopped by:** an authenticated author first receives a 15-minute, one-time
upload capability whose site, declared MIME and exact byte count are stored in a
private intent row. The receiver exchanges that capability before reading the
body, enforces `Content-Length` and a streamed hard bound, and writes only to a
server-owned temporary key. The worker sniffs and decodes JPEG/PNG/WebP with
libvips through `sharp`; SVG, executable/non-image bytes, MIME spoofing,
dimension bombs and pixel bombs are refused. EXIF orientation is normalized,
metadata is stripped, and immutable content-addressed original, thumbnail, card
and wide objects are recorded only after their exact hashes, sizes and
dimensions pass the database contract. A public URL resolves by normalized
site host, media id and a closed variant name; neither browser role can read an
object key. Page-version insertion and publication independently refuse a
deleted, unresolved, cross-site or missing-variant reference.

The private admin media endpoint allows browser storage with `private, no-cache`.
Each request still checks the current session and tenant before a matching ETag
can return 304 without reading storage. Bytes previously delivered can remain
in the browser cache after access is revoked; a later request is still denied.

A matching public media or font validator checks current publication and
returns no bytes. It cannot detect corruption in an object it did not read.
Responses that serve new bytes still run the existing storage integrity checks.

Deletion is a recoverable state change first. Physical cleanup is delayed and
bound to the current outbox lease by a durable claim, so a restore either wins
before cleanup or is refused while cleanup owns the object set; a retry may
remove the same immutable keys again safely. Upload, inspection, failure,
delete, restore and cleanup decisions are auditable.

**Proved by:** `media.db.test.ts` against real application roles,
`apps/worker/src/media.test.ts`, platform filesystem-store tests, admin/site
delivery-route tests, and `media-library.spec.ts`. The browser journey uploads
real PNG bytes, runs the monitored one-shot worker, receives a generated WebP,
places it through the editor, publishes it into server-rendered HTML, removes
the page reference, then soft-deletes and restores the asset. The 4MB+ worker
fixture proves the card rendition remains at or below 200KiB.

**Still external:** production bucket/CORS/retention policy and storage backup
are deliberately deferred to V2-SETUP-08. Per-user upload rate limits and
tenant storage quotas remain part of operations hardening; the current byte,
pixel and batch bounds prevent one request from becoming unbounded work but do
not allocate a business quota across many valid requests.

## 9. Worker running with excessive privilege

**Stopped by:** `cms_worker` is neither superuser nor `BYPASSRLS`, holds no
membership or audit DML, and cannot mutate a published pointer or call
`publish_page` at all — a scheduled publication must go through
`execute_scheduled_action`, which pins the version and settles in the same
transaction.
**Proved by:** `isolation.db.test.ts`, `worker-identity.db.test.ts`.

## 9a. One worker impersonating another

Every worker process authenticates as the same database role, so a worker id a
session asserts about itself authorizes nothing. An adversarial review proved
this: with the id derived from a session GUC, a second worker only had to run
`set_config('app.worker_id','worker-a')` to settle worker A's in-flight events,
execute A's leased schedules — publishing a page — and forge A's heartbeat.

**Stopped by:** lease tokens (migration 0009), made actually secret in 0010.
Claiming a row mints an unguessable uuid returned only to the claimant;
settling, executing, and failing that row all require it. A capability cannot be
asserted into existence. `leased_by` remains as an operator-facing label only.

The 0009 form was incomplete, and a second review proved that too. 0002 granted
`cms_worker` table-level SELECT on `outbox` and 0007 did the same for
`cms_authenticated_user`; a table-level grant covers columns added afterwards, so
the token was readable by everyone who could read the queue —
`has_column_privilege('cms_worker','outbox','lease_token','SELECT')` was `true`.
Unguessable is not the same as secret. 0010 closes it twice over:

* the column holds a **SHA-256 digest**, so there is no token in the table to
  read — a privileged read, a backup, or a replica recovers a digest, and a
  digest cannot be presented to settle;
* the table-level grants are **replaced by explicit column lists**, so the next
  column someone adds is not silently granted. The worker has no table-level
  SELECT on either queue table at all and reaches them only through the
  functions.

The digest is cleared on every delivered, dead, retry, succeeded, failed, and
blocked transition, so a token authorizes exactly one settlement.

**Proved by:** `worker-identity.db.test.ts` (a forged worker id with a wrong
token is refused on every operation) and `lease-secrecy.db.test.ts` — worker B
cannot read the digest by name or through `SELECT *`, an editor cannot read it on
their own site's rows, a re-claim rotates it, a spent token cannot be replayed,
and a sweep asserts no application role holds any privilege on any
`%lease_token%` column of any table.

**Not covered:** `app.worker_heartbeat` still keys on the self-asserted id, so a
worker can write a heartbeat row under another worker's name. The consequence is
a misleading operator display, not an authorization bypass — no work can be
claimed, settled, or published through it. Closing it properly needs a distinct
database login per worker, which is an M5 deployment decision (SPEC §12,
V2-SETUP-07) rather than a schema change. Recorded as a test rather than an
absence: `worker-identity.db.test.ts` asserts the label *is* forgeable, and that
a forged session still claims no work.

## 10. Leaked provider credential

**Partly covered.** There is no service-role credential in the codebase to leak
(ADR 0002), and each role's credential grants only that role's privileges — a
leaked public-renderer credential reads published pages, which are public. Secret
rotation and provider-token scoping are M5 (SPEC §12, V2-SETUP-09/10).

## 11. Draft exposure through preview

**Stopped by:** the preview route resolves the session server-side, checks the
version is visible to that session under RLS, and `build_render_manifest` itself
re-checks site access because it is `SECURITY DEFINER` (migration 0006).
Preview responses are `no-store`, `noindex`, and `frame-ancestors 'self'`.
**Not yet covered:** shareable preview tokens for a reviewer without an account.
That needs a designed boundary before it ships (SPEC §8) and is not implemented.

## 12. Review confusion and workflow escalation

**Threat:** a contributor publishes by bypassing the interface; a reviewer
approves newer work than the version they inspected; a same-site contributor
reads or plants discussion on somebody else's request; a guessed cross-site id
reveals whether a foreign page is under review; or an ordinary editor approves
governed custom code through the queue.

**Stopped by:** submission freezes a new immutable `submission` version and the
decision command locks page before submission, requires that exact version to
remain the current head, and calls the one publication core. Direct Publish
refuses an open reviewed head after resolving and authorizing the page, so a
foreign caller gets the same answer regardless of workflow state. Submission
reads are submitter-or-reviewer; comment reads and writes additionally bind to
the exact submitted page version. Comment authors, resolvers and decision
actors are derived from session context. Trusted code remains super-admin only,
and the read model returns that capability so the interface never offers a
control SQL will refuse. Exact deep links filter in SQL before queue pagination,
so an old request cannot be silently replaced by a different recent request.
Every new definer function belongs to the named non-login migration owner.

**Proved by:** `review.db.test.ts` as real contributor/editor/super-admin and
wrong-site roles, the global function-owner assertion in `drift.db.test.ts`, and
`review-workflow.spec.ts` across contributor editor, reviewer inbox, exact
preview, rejection feedback, governed-code handoff, approval and public output.
The browser test also changes queue selection with a comment and mention in
progress, proving request-local state does not cross decisions.

**Not yet covered:** external mail notifications, recent-auth challenges for a
high-risk approval, custom-section requests and the merged domain/job owner
inbox. None is implied by an @mention today; discussion remains inside the CMS.

### Scriptless private-image previews

Readonly page/history/review/upgrade and Design/header/footer previews retain
same-origin identity with `sandbox="allow-same-origin"`. Omitting that permission
made their documents opaque origins and blocked authenticated image delivery's
`Cross-Origin-Resource-Policy: same-origin` response. The permission does not
include scripts, forms, popups, downloads or top navigation. The editing canvas
keeps its separate, hash-pinned message-bridge policy.

Readonly and release response CSP independently disables scripts, forms, child
frames, objects, connections and base URLs. SrcDoc previews receive the same
policy in a meta element at the beginning of the generated head, because
fetching HTML and assigning srcDoc does not carry the response's CSP headers.
An authored policy cannot relax these restrictions. Media is fetched through
the authenticated media endpoint, which checks the session and tenant on
each request before returning bytes or a cache validator. The previews do not
embed media bytes or expose a separate bearer URL.
