# The national template

Use one national design and keep each site's identity and content separate.

For: Site admins and Super admins. Last checked: 2026-11-03.

SAWSO and Echelon starting themes share a parent. Colours, buttons, layout,
white containers and shared sections belong to that parent. Each site owns its
logo, menu, footer words, content, tags and approved heading-font choice.
SAWSO uses small capitals; Echelon stays sans-serif. Colour changes start off.
The database prevents a Site admin from detaching or unlocking the parent.

## Review an update

A Super admin opens Template from an eligible site's menu. Review an update
shows the saved page before and after, plus the affected sites and pages.
Preview on opens the first selected site that needs an update. If no site needs
an update, it can show the first available site. Choosing a preview does not
select that site for an update. An unavailable preview blocks Create drafts;
choose a valid site again to reload the preview and clear its earlier error.
Missing, private or foreign list bindings remain refused.
Choose sites, then Create drafts. The update uses the existing guarded save
commands in one transaction; a changed saved page requires a fresh review.
Changed field types or removed content fields require review in the page editor.
Open Publish on each site to review and release its drafts.

## Start a site

Choose Start a site from this. Enter its name and test address, then choose a
copy of a national-template site, the saved national/chapter page set, or Home
only. Words and stories are optional when copying. Without words, editable
content becomes labelled samples while section layout and item counts stay.
Archived source pages stay in the source site and its backups. A new site copies
active pages and their saved history; it does not bring retired pages back.
Only needed media and existing font assets are copied, with checksum checks.
Copied current pages keep using the parent's shared sections. Set up the new
site's identity, menu, footer and people before its first release.

An untouched dialog can cancel without a save. After changing setup, Cancel,
close and Escape offer Keep editing, Discard changes, or Save draft and leave.
Saving keeps valid choices only in this browser, for this account and the site
where you opened Template. It creates no site. Reopen Start a site from this to
restore those choices; Clear saved setup removes that browser copy. Discard
changes restores the opening choices, keeping an earlier saved setup if present.

Invalid choices or a failed browser save keep the fields open. If a saved source
site is unavailable, choose a current source before saving or creating. A failed
Clear saved setup also retains the form. The setup stays private to this browser;
copy the choices if you need them elsewhere.

Create private site remains the explicit creation action. Wait for it to finish
before leaving; it keeps one request for retries and a saved setup can retain
that request after an uncertain result. Check Sites before retrying an uncertain
creation. A successful creation stays private until first publish.
Retries use the same request and preserve later saved work. Very large copies
remain within the existing 64 MB transfer and decoded-image safety limits;
turn off words/stories or choose a page set if that limit is reached.

## Verified and remaining

Focused real-role tests cover stale review, draft-only application, permissions,
private copies, shared pins, sample labels, retained layout/item counts and
creation retries. Chromium exercises the screen, Cancel, review/apply, private
copy and role isolation at 1440/1024. Both apps and type/style checks pass.
The per-piece browser ledger records the focused WebKit result.

The retained sites' final template rollout and Echelon reference replacement
remain in the Round3 roadmap. See [Fonts](fonts.md) for the separately checked
local Adobe connection and domain requirements. Existing snapshots were preserved
by the template-policy migration.

The 482,172-byte national Bootstrap reference is retained in private source storage
outside Git. Verify its local checksum before use.
The older receipt incorrectly says both files were unavailable; the original
successful response is not retained, so the declared source attribution still
needs verification. The Bootstrap header says MIT, while the custom theme licence
remains Needs administrator input. Keep this reference outside the product build, including its
font import. The corrected source names only bootstrap.css; do not look for
site.css. Public look/behavior comparison remains required before completion.

## Copied site settings and first publication

A copy keeps its chosen destination name, including its copied Settings history.
Older name-only Settings are translated to the supported format as new records
in the copy; the source site's records stay unchanged. Existing supported Search
and Social blocks stay private in the copy until its complete first review.

Publish the new site's pages and required shared items together. In History,
recovering that first release can return the complete site to private, including
Settings that had no earlier public version. Current drafts remain retained.
Review and publish the full site again when it is ready. This is local behavior,
not a deployment or a domain connection.
