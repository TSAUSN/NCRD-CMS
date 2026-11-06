# Story source capacity upgrade

Keep app code, database functions and published widget snapshots compatible.

For: Super admins and maintainers. Last checked: 2026-10-31.

Verified locally: migration0183 and the matching app support managed World View
and Split View pools up to the library's2,000-entry capacity. Ordinary authored
repeat bindings and other readers stay at 200. No stored binding or content is
backfilled. A later normal publication rebuilds affected snapshots. The1.8MB
manifest guard is unchanged; unused optional article bodies are omitted from
managed card projections, while required fields and media validation remain.

Before applying, keep a database dump and the matching app commit. Apply functions
and the compatible app together. Check counts beyond200, private/public separation,
Show more, no-JavaScript navigation and sector6. The local retained dump was kept;
actual retained content and source-read counts remain unchanged.

An older renderer refuses a Story envelope with more than 200 entries. After
such a widget snapshot is published, stepping back only the app can erase its
visible cards. Restore matching code and database/snapshot state together using
the pre-change dump. Restoring an older dump also removes later edits; preserve
those separately before restoring. This restore procedure has not yet been
rehearsed for 0183. The planned local staging/restore exercise must prove it before
a real rollout. No hosted Google environment, deployment or live restore was used.
