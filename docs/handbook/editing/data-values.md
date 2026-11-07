# Data values

Save a number once, with its source, and publish it to every page that uses it.

For: Editors, Site admins and Super admins. Last checked: 2026-11-02.

An Admin opens Data values from the site menu. Add a number with a specific
label, value, source and as-of text. Save draft keeps it private. Schedule and
Publish first prepare the usual site release review. The review shows the
saved old and new values and the number of distinct pages that use it. History
uses the existing settings recovery path. Other saved Settings changes are
included in that settings review; check every listed change.

When the release contains only changed numbers, readiness checks the published
pages that use those numbers. An unused number can be published for future use
without asking you to approve unrelated page content.

On a stat's Number field, an Editor chooses Use a saved number. The number list
is read-only there. Words before or after the number and the stat's own label
remain page content. Choosing a number just on this page disconnects it while
retaining the currently chosen value. Page changes still need their usual
review. Publish new saved numbers together with pages that first use them.

Needs checking is a status, not a publication request. It never changes a page
by itself. Unsourced legacy figures remain marked until checked. Do not delete
a number while a current page still uses it; replace those page references
first. Old settings versions remain immutable.

Fill from a file reads a public HTTPS JSON address or a published sheet's CSV
export only after Review file is pressed. Only an Admin can request this read. It sends no sign-in details, checks and
pins a public address on every redirect, and reads at most 1 MB. An unavailable
remote file can be downloaded and chosen in the local JSON/CSV picker instead. The approved
SAWSO story feed is reserved for Stories Refresh and is refused here. There is
no background sync and no automatic publication.

Files use label, value and source columns/keys, with optional unit and asOf.
A changed value needs its own supplied source; the previous source is not silently
reused. Review Now/In the file, add any missing sources, and save the changes as a
private draft. Changed imported numbers start as Needs checking. Existing IDs
stay stable when matched; this never imports people, stories or arbitrary HTML.

Local Chromium and one focused WebKit journey verify two-page publication,
private saves and JSON import, required sources, an Editor picker without list
access, and proper no-access responses. Native Chromium retained 1440/1024 screens, empty state,
remembered panel width and Keep editing/Discard were inspected. No hosted
behavior or final fresh-account acceptance is claimed. Real remote-file success
was not exercised; its address/redirect/size rules were tested with bounded
transports. The annual report and source links use the existing reviewed private content.

On a site's first Settings save, the existing name-only public baseline may be
recorded for History. New numbers stay private; this does not publish their
values or change page publication.

Mark a fixed historical number Doesn't change. File review keeps it as it is.
Choose Needs checking or Matches report explicitly before changing its value.
The picker fills an empty or example stat label; your local wording is preserved
afterward. Existing numbers show their published value in the picker, so a
private update cannot silently change what a writer sees.

Text can keep paragraphs, bold words and links around its saved numbers.
Click that text to choose its numbers in the panel. Each saved number has its
own choice. To edit the wording independently, choose **Use a number just on
this page**. Its formatting stays, and it then uses the normal text editor.
Changing a choice or detaching saves a page draft; the public page stays as it
was until the normal review and publish step.

At 1440/1024, the number inspector stays beside the table. Resize its inside edge;
the table keeps room and the preference is remembered. Back/Done stay at the top,
Save draft/Schedule/Publish stay at the bottom, and the fields scroll between.
Names and values stay on one line; hover for the full text. A narrow table hides
source/date columns while the inspector retains them. The source display switch
and shown-on page chips keep their existing meaning. No saved value is changed
by resizing, filtering or opening the inspector.

Fill from a file uses a compact entry dialog. Its wider review keeps a source
field for each number, so missing sources can be supplied before Save as draft.

When picking a saved number on a page, Words around this number keeps optional
before/after text together. It starts closed when both are empty and opens for
existing wording. The source and Admin ownership stay visible. If publication
says the saved numbers are still drafts, ask a site admin to review and publish
those numbers first; the Editor cannot bypass that dependency. Other independent
pages or stories can still be published through their own reviewed changes.
