# Recovering site-wide settings

Site settings use the same reviewed release and recovery path as other saved work.

For: Admins and Super admins. Last checked: 2026-11-01.

Social accounts and Search & sharing are available. General uses the same
private drafts and reviewed publication; its screen is locally checked.
Existing setup and maintenance tools are grouped under Settings. This guide
records the storage and release contract; check each matching screen guide for
its actual verification boundary.

A settings draft does not change the public site. Publish lists Site settings
with specific changes such as Site name, Contact email and Instagram address.
An Admin reviews those changes before confirming publication. A newer draft
requires another review. Scheduling uses the same reviewed release engine.

In Publish, open History, the applied release, then Review recovery. Preparing
recovery creates private drafts. Review and publish that recovery before the
public site changes. Later settings drafts remain retained in immutable history.
The first settings change also retains the name that was already public, so
that first change can be recovered.

No existing site adopts new General, Search & sharing or Social accounts values
merely by opening a screen or upgrading the app. Sites without those optional
blocks keep their existing public output. Copying a site uses the new site's
chosen name in its settings history; it must not later rename itself to the
source site's name.

Local verification covers permissions, stale-save refusal, draft privacy, normal
release review, publication and History recovery. Google hosting, a remote
backup restore and production operation are not verified by those checks.
Database migration 0187 adds commands and release recovery pins, without a
content backfill. Step back with a matching application and database backup,
or a tested forward compatibility change; do not edit applied migration files.

Copies may have private Settings before their first release. Migration0188
normalizes newly copied legacy name-only values and writes the destination
name. It also lets coordinated first-release recovery clear the copied site's
public Settings pointer, using the same reviewed unpublish intention as its
other first-release items. Existing Admin, exact-version and revision checks
remain required; the source and later private drafts are preserved. There is no
backfill or rewrite of existing retained Settings history.

Unknown older Settings fields are preserved during import rather than silently
discarded. Only the supported current format and older name-only format are
automatically normalized. An unrecognized older format needs explicit review
and a compatibility change before its Settings can be published.
