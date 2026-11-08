# Private release handoff checklist

For the maintainer and the receiving platform administrator. The release is
`v2026.11.06`; `e51b4b5` was the runtime-identical review build. Record the
full Git commit and deployed image digest separately. A current environment’s
`/health` is the authority for the build it serves.

## Transfer privately

Use the approved private transfer channel. Put actual values in the receiver’s
private operator packet, outside Git. The examples here are placeholders.

| Check | Value to send | Receiver verifies |
| --- | --- | --- |
| [ ] Release source | `RELEASE_TAG`, `FULL_RELEASE_SHA` | Resolve the tag locally and compare the full commit. |
| [ ] Cleaned PostgreSQL dump | `PRIVATE_DUMP_PATH`, `DUMP_SHA256` | Hash the archive before restoring to a new scratch database. |
| [ ] Database fingerprints | `FINGERPRINTS_JSON`, `SOURCE_DATABASE_TIME_ZONE` | Compare table counts and hashes with the source time zone before migrations, then verify the documented migration-only differences. |
| [ ] Media and inventory | `PRIVATE_MEDIA_DIRECTORY`, `MEDIA_INVENTORY_JSON` | Verify each object’s path, byte count and SHA-256. |
| [ ] Public asset oracle | `PUBLIC_ASSET_ORACLE_JSON`, `EXPECTED_ASSET_COUNT` | Fetch only the target copy’s assets and compare size and hash. |
| [ ] Page count | `EXPECTED_PUBLIC_PAGE_COUNT` | Check every kept route on the target copy before routing users there. |
| [ ] Supabase sign-in | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Verify the owning project and use only its publishable key. |
| [ ] Admin callback | `NEW_ADMIN_ORIGIN/auth/confirm` | Add this exact HTTPS URL to the project’s allowed redirects; keep existing callbacks until the transition is verified. |
| [ ] Super admin | `SUPER_ADMIN_EMAIL` | Confirm a fresh sign-in opens the correct CMS and resolves to the intended account and role. |

Verify the archive and media before starting any app. See [the restore and
release sequence](friday-go-live.md) and [recovery](../upgrades/backup-recovery.md).
Do not transfer service-role keys, account passwords, or session links in this packet.
The receiving administrator manages the environment’s secrets through its own approved store.

## Record hosted role acceptance

Use the personal review copy and keep the completed account inventory and
walk receipts in the private operator packet. Use a distinct approved sign-in
address for each scope. These are placeholders for the operator's checklist.

| Role | Private identity placeholder | Scope to verify |
| --- | --- | --- |
| Super admin | `SUPER_ADMIN_EMAIL` | Both sites and People & access |
| SAWSO site editor | `QA_SAWSO_EDITOR_EMAIL` | Assigned site, including draft review and publication |
| SAWSO content creator | `QA_SAWSO_CONTRIBUTOR_EMAIL` | Assigned authoring and submit for review |
| Echelon division editor | `QA_ECHELON_DIVISION_EMAIL` | Assigned division and chapter publication |
| Echelon chapter contributor | `QA_ECHELON_CHAPTER_EMAIL` | Assigned chapter and submit for review |

Verify sign-in delivery before provisioning these accounts. In Supabase, check
**Authentication → Emails → SMTP Settings**. The default sender can only reach
project-team addresses. Record any role you could only walk locally as local.
Use the CMS's [access controls](../people/adding-a-person.md) to assign the
smallest scope and confirm the visible role after sign-in. Check both the
permitted actions and direct access to an unassigned site, division or chapter.
Archive or remove disposable drafts after the walk and record where the test
accounts remain. Keep passwords, authentication links and session data out of
the handoff notes. [Supabase email delivery documentation](https://supabase.com/docs/guides/auth/auth-smtp).

## Move sign-in ownership

1. Inventory the provider project’s apps, callbacks, roles, billing and recovery
   contacts. If it is shared with other personal apps, agree on a separate migration
   instead of transferring those apps inadvertently.
2. For a dedicated project, the source organization owner follows
   [Supabase’s project transfer procedure](https://supabase.com/docs/guides/platform/project-transfer)
   from the project’s General settings. Confirm destination membership and provider
   prerequisites before transferring. Assign the receiving team ownership and
   recovery access; verify who can manage Auth and billing.
3. Verify the same project URL, publishable key, allowed callbacks and existing
   account subjects. Test a fresh Super admin sign-in, sign-out, and a scoped
   editor session on review before removing old operator access. Keep an approved
   rollback route and verify that notification delivery works before editor rollout.
4. If a new project is required, rehearse the identity migration first. Preserve
   CMS user IDs and memberships. Map the new provider subjects explicitly; matching
   an email is insufficient to replace an existing binding. Review the
   [sign-in migration and rollback guide](sign-in-options.md) before switching.

A sign-in transfer does not move the Cloud SQL content, change DNS, or deploy the CMS.
