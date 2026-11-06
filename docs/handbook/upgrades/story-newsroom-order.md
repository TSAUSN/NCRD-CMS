# Upgrading Story ordering

Add optional Story controls without replacing articles or expanding permissions.

For: Super admins and maintainers. Last checked: 2026-11-01.

Local migration0184 adds a five-position integrity check to the existing entry
save command and prioritizes featured entries in unfiltered Story selections.
It preserves the existing actor, role, revision and value checks. It also carries
the position into full Story widget snapshots. Filtered sources and sector/map
views preserve date order, including equal-date source ordering. No article rows are rewritten
by the migration. The migration applied successfully in the isolated local
test database; Google staging and production are not yet verified.

Update Stories is a separate administrator action. It adds optional Author
and Newsroom order fields through the existing draft model command. Review
and publish normally. Content editors then save ordinary Story entry drafts.
Source refresh owns neither of these fields. Keep a data dump before adoption.

To return to date-only news on the current code, remove featured stars through
normal drafts and publish. Optional saved fields can remain. Do not delete
articles. A code rollback to before the Story ordering update is unsafe: those renderers reject the new
Story display metadata, and the database selection rules remain changed. Restore
the paired code/database backup, or rehearse a new forward compatibility
migration that removes that metadata and refreshes public projections before
rolling code back. Do not edit applied migration files. A paired restore and
a hosted migration are not yet rehearsed; the Google environment plan must
verify them before administrator deployment.

Migration0185 adds a combined-public-position guard to the existing scoped
Story publication command. Release review simulates that same command, so a
partial swap or sixth live feature is refused before publication. Group
publication and independent words retain their normal paths. Manual widgets
keep their selection/date behavior. No article rows are rewritten.

Migration0186 preserves unchanged Story heads when every existing field
definition is identical and additions are limited to the exact optional
Author/Newsroom order fields. Identical-field policy changes are compatible.
The existing save validation still runs before a no-op decision; scoped/group
publication validate values and the same strict compatibility. Other readers
and other field changes keep their explicit upgrade requirements. No automatic data
backfill or record-access grants. The read-only compatibility function follows
the caller's existing row access. Roll back through a reviewed forward
migration or a rehearsed paired restore, never by editing applied history.

An older, structurally different Story model appears in Publish as Update editing
controls for N stories. Review and publish that normal one-time update before
editing individual stories. It preserves their existing words and photos and
adds the approved control defaults. Optional compatible additions need only
the fields publication, with no zero-change items choice.
