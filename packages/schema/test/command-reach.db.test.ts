// AUTH-01 / AUTH-05: what the admin's database role can run. Every security
// definer command it may execute must check the caller (an actor, a site role
// or a permission), or be on the reviewed list below with the reason it needs
// none. A new command that skips both fails here instead of shipping.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'

// Reviewed October 6. Each is safe without its own actor check, for the reason given.
const REVIEWED: Record<string, string> = {
  is_scoped_chapter_email:
    'local server sign-in boundary: active page assignment predicate, no content; local-only transport returns a constant sent result',
  queue_local_chapter_sign_in:
    'local server sign-in boundary: loopback origin, bounded token, active page assignment; records only in private local outbox, never sends',
  consume_local_chapter_sign_in:
    'single-use SHA-256 bearer capability with fixed expiry; rechecks active assignment and local subject, no caller-selected user',
  attach_auth_subject: 'server sign-in boundary: links an identity the provider already verified to an active account',
  has_page_access: 'predicate on the current active actor and assigned page; returns no content',
  has_scoped_site_access: 'predicate on the current active actor and assigned pages; never grants whole-site commands',
  has_site_access: 'predicate on the current actor’s site role',
  can_administer_site: 'predicate on the current actor’s site role',
  job_queue_health: 'queue counts only, no content',
  media_upload_for_receipt: 'single-use upload capability token',
  mark_media_upload_received: 'single-use receipt capability token',
  fail_media_upload_receipt: 'single-use receipt capability token',
  save_global_elements_draft:
    'reviewed November 3: the five-argument wrapper delegates to the six-argument command, which requires an actor and can_publish before saving',
  release_fingerprint:
    'reviewed November 3: delegates through release_fingerprint_before_public_settings and the prior site-files wrapper to the base fingerprint, which requires an actor and site access',
  export_site_content: 'delegates to export_site_content_before_assets: require_actor and can_administer_site',
  finish_site_release: 'delegates to finish_site_release_before_recovery, which checks',
  record_site_release: 'delegates to record_site_release_before_recovery, which checks',
  publish_collection_entries: 'delegates to guard_collection_review_publication and the core command, which check',
  publish_collection_schema: 'delegates to guard_collection_review_publication and the core command, which check',
  upsert_section_def_version: 'delegates to check_section_authoring, the role boundary for definitions',
  build_render_manifest: 'checks has_site_access on the version’s site',
  preview_global_component: 'checks has_site_access',
  use_page_recipe: 'checks has_site_access on the recipe’s site',
  current_user_id: 'the actor primitive itself: the active user named by app.user_id, or null',
  is_super_admin: 'predicate on the current actor',
  site_role: 'predicate on the current actor',
  scheduling_available: 'requires current_user_id() and reports only worker liveness',
  release_schedule_capability:
    'reviewed October 26: exact active, due, unexpired queue-lease capability resolves only its stored actor/release; wrong, foreign-job and expired tokens return no row; no caller-selected actor',
  resolve_session: 'server sign-in boundary: resolves a verified identity to its own account and memberships',
  is_invited_email: 'server sign-in boundary: sign-in answers “sent” either way, so no account is revealed',
}
const CHECKS =
  /(require_actor|current_actor|can_[a-z_]+\(|is_super_admin|require_[a-z_]+\(|has_site_access|has_page_access|site_role\()/i

let db: TestDatabase
beforeAll(async () => {
  db = await TestDatabase.create('command-reach')
})
afterAll(async () => {
  await db?.close()
})

describe('the commands the admin role can run', () => {
  it('each checks its caller, or is reviewed as not needing to', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ name: string; source: string }>(`
      SELECT p.proname AS name, p.prosrc AS source FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='app' AND p.prosecdef AND has_function_privilege('cms_authenticated_user', p.oid, 'EXECUTE')
        AND pg_get_function_result(p.oid) <> 'trigger'`),
    )
    expect(rows.length).toBeGreaterThan(100)
    const unchecked = rows.filter(row => !CHECKS.test(row.source) && !REVIEWED[row.name]).map(row => row.name)
    expect(unchecked).toEqual([])
  })
  it('no longer reaches the shell rebuild or the cross-site revalidation list', async () => {
    await expectSqlState(
      db.as('authenticated', c => c.query("SELECT app.rebuild_site_shell('00000000-0000-4000-8000-000000000000')")),
      '42501',
    )
    await expectSqlState(
      db.as('authenticated', c => c.query('SELECT * FROM app.section_definitions_needing_revalidation()')),
      '42501',
    )
  })
  it('lets only the admin role resolve a sign-in, not the public renderer or the worker', async () => {
    await expectSqlState(
      db.as('public', c => c.query("SELECT * FROM app.resolve_session('subject','a@example.test')")),
      '42501',
    )
    await expectSqlState(
      db.as('worker', c => c.query("SELECT * FROM app.resolve_session('subject','a@example.test')")),
      '42501',
    )
    const { rows } = await db.as('authenticated', c =>
      c.query("SELECT * FROM app.resolve_session('subject','nobody@example.test')"),
    )
    expect(rows).toEqual([])
  })
  it('gives PUBLIC no security-definer command in the app schema', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ name: string }>(`
      SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='app' AND p.prosecdef AND pg_get_function_result(p.oid) <> 'trigger'
        AND (p.proacl IS NULL OR p.proacl::text ~ '(^|,|\\{)=X/')`),
    )
    expect(rows.map(row => row.name)).toEqual([])
  })
})
