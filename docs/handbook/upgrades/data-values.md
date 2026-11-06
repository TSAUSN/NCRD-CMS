# Updating numbers and stepping back

Keep a compatible application and database when stepping back.

For: Super admins and maintainers. Last checked: 2026-11-01.

Named numbers use the existing immutable site settings. Publish and recovery
keep the complete settings version, including sources, as-of text and stable
number IDs. Current pages must retain their referenced IDs. Remove page
references before deleting a number; use a reviewed recovery for value changes.

The initial numbers addition and the fixed-number status need matching
application support. Earlier builds can reject the new settings fields or
status and fall back to old page text. Do not assume rolling back application
files alone preserves current figures. Use a compatible build or restore the
matching database backup using the later hosting/restore plan.

Unfreeze a fixed number explicitly before changing its numeric value. A
recovery that also changes its status can do that through review. No migration
rewrites existing numbers or pages. The local retained demo has a preserved
dump before each of these pieces. Hosted restore is still unverified.
