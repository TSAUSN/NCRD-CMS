// Explicit operator cleanup of an offline, freshly restored LOCAL copy only.
// This is never a migration, seed, worker task or hosted operation.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../packages/schema/package.json', import.meta.url))
const { Client } = require('pg')
const KEPT = ['sawso', 'echelon-chapters', 'echelon']
const ARCHIVED = ['bt2027-r8', 'hni']
export function hostedCopyTarget(raw) {
  const url = new URL(raw)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port !== '54329' ||
    !/^\/cms_hosting_[a-z0-9_]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw Error(
      'Use a fresh local cms_hosting_* copy on 127.0.0.1:54329. Retained, test and hosted databases are refused.',
    )
  }
  return url
}
async function prepareHostedCopy({ databaseUrl, ownerEmail, ownerName, backupRoot }) {
  const url = hostedCopyTarget(databaseUrl)
  if (
    !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ownerEmail) ||
    /\.(test|localhost)$/i.test(ownerEmail) ||
    !ownerName?.trim() ||
    ownerName.length > 120 ||
    /[\r\n]/.test(ownerName)
  )
    throw Error('Supply the real owner email and display name.')
  const directory = resolve(backupRoot)
  if (/^\/(?:private\/)?tmp(?:\/|$)/.test(directory))
    throw Error('Keep the backup in private durable local storage, outside tmp and Git.')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    execFileSync('git', ['-C', directory, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
    throw Error('Backup directory is inside Git.')
  } catch (error) {
    if (error.message === 'Backup directory is inside Git.') throw error
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(directory, 'before-cleanup-' + stamp + '.dump')
  execFileSync('pg_dump', ['--dbname=' + url.href, '--format=custom', '--file=' + backup], { stdio: 'pipe' })
  if (statSync(backup).size === 0) throw Error('Backup is empty.')
  const c = new Client({ connectionString: url.href })
  await c.connect()
  const snapshot = async () => {
    const result = {}
    for (const table of [
      'pages',
      'page_versions',
      'chapters',
      'chapter_versions',
      'collection_entries',
      'collection_entry_versions',
      'published_routes',
      'published_site_shells',
    ]) {
      result[table] = (
        await c.query(
          `SELECT to_jsonb(t) AS row FROM public.${table} t JOIN sites s ON s.id=t.site_id WHERE s.slug=ANY($1::text[]) ORDER BY to_jsonb(t)::text COLLATE "C"`,
          [KEPT],
        )
      ).rows
    }
    return JSON.stringify(result)
  }
  try {
    await c.query('BEGIN')
    await c.query("SELECT pg_advisory_xact_lock(hashtext('cms:prepare-local-hosted-copy'))")
    const sites = (await c.query('SELECT id,slug,status,revision FROM sites ORDER BY slug')).rows
    if (sites.length !== 5 || [...KEPT, ...ARCHIVED].some(slug => !sites.some(site => site.slug === slug)))
      throw Error('Expected exactly the five reviewed demo sites; refusing an unfamiliar installation.')
    const owners = (
      await c.query(
        "SELECT u.id,u.email FROM app_users u JOIN global_roles g ON g.user_id=u.id WHERE g.role='super_admin'",
      )
    ).rows
    if (
      owners.length !== 1 ||
      (!/@example\.test$/i.test(owners[0].email) && owners[0].email.toLowerCase() !== ownerEmail.toLowerCase())
    )
      throw Error('Expected one local demo administrator or this already configured owner.')
    const owner = owners[0]
    const before = await snapshot()
    await c.query("SELECT set_config('app.user_id',$1,true)", [owner.id])
    for (const site of sites.filter(site => ARCHIVED.includes(site.slug) && site.status !== 'archived')) {
      await c.query('SELECT app.archive_site($1,$2)', [site.id, site.revision])
    }
    // The local admin is the existing administrator identity. Preserve its immutable
    // historical references while replacing its demo-only login and label.
    await c.query(
      "UPDATE app_users SET email=$2,display_name=$3,status='active',auth_subject=NULL WHERE id=$1 AND (email<>$2 OR display_name<>$3 OR status<>'active' OR auth_subject IS NOT NULL)",
      [owner.id, ownerEmail.toLowerCase(), ownerName.trim()],
    )
    const samples = (
      await c.query(
        "SELECT id FROM app_users WHERE id<>$1 AND (email ~* '@example\\.test$' OR display_name ~ '^\\s*\\[' OR display_name ~* '\\(sample\\)')",
        [owner.id],
      )
    ).rows.map(row => row.id)
    // Access rows may be removed. Any historical reference makes DELETE fail
    // and rolls the complete cleanup back instead of rewriting authorship.
    await c.query('DELETE FROM page_memberships WHERE user_id=ANY($1::uuid[])', [samples])
    await c.query('DELETE FROM chapter_division_memberships WHERE user_id=ANY($1::uuid[])', [samples])
    await c.query('DELETE FROM local_chapter_sign_in_links WHERE user_id=ANY($1::uuid[])', [samples])
    await c.query('DELETE FROM canvas_preview_tickets')
    await c.query('DELETE FROM app_users WHERE id=ANY($1::uuid[])', [samples])
    const accounts = (await c.query('SELECT id,email,status FROM app_users')).rows
    if (accounts.length !== 1 || accounts[0].id !== owner.id || accounts[0].email !== ownerEmail.toLowerCase())
      throw Error('Cleanup must leave exactly the one configured owner.')
    if ((await c.query('SELECT count(*)::int AS n FROM domains')).rows[0].n !== 0)
      throw Error('The copy contains domains. Refusing to carry DNS/custom-domain work into hosting.')
    if (
      (await c.query("SELECT count(*)::int AS n FROM scheduled_actions WHERE status IN ('pending','running')")).rows[0]
        .n !== 0
    )
      throw Error('Review copied schedules before hosting; no schedule was changed.')
    if (before !== (await snapshot()))
      throw Error('Kept site pages, versions, chapters, stories or public projections changed; rolling back.')
    await c.query('COMMIT')
    const result = {
      database: url.pathname.slice(1),
      kept: KEPT,
      archived: ARCHIVED,
      removedSampleAccounts: samples.length,
      ownerId: owner.id,
      ownerEmail: ownerEmail.toLowerCase(),
      backup,
      keptContentUnchanged: true,
      mediaChanged: false,
    }
    writeFileSync(join(directory, 'cleanup-' + stamp + '.json'), JSON.stringify(result, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    })
    return result
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await c.end()
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [databaseUrl, ownerEmail, ownerName, backupRoot] = process.argv.slice(2)
  if (!databaseUrl || !ownerEmail || !ownerName || !backupRoot)
    throw Error(
      'Usage: node scripts/prepare-hosted-copy.mjs LOCAL_COPY_URL OWNER_EMAIL OWNER_NAME PRIVATE_BACKUP_DIRECTORY',
    )
  console.log(JSON.stringify(await prepareHostedCopy({ databaseUrl, ownerEmail, ownerName, backupRoot }), null, 2))
}
