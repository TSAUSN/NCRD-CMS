import { afterAll, beforeAll, expect, it } from 'vitest'
import { Client } from 'pg'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { migrate, type AppliedMigration } from '../src/migrate/index.ts'
import { CHECKED_CLEAN, requireTestDatabase } from './harness.ts'
import { heroContent } from './fixtures.ts'

const name = `cms_hosting_upgrade_${randomUUID().slice(0, 8)}`
const actor = 'aaaaaaaa-1111-4111-8111-111111111111'
let admin: Client, client: Client, url: string, applied: AppliedMigration[]
let before: Record<string, string>, access: unknown[]

async function fingerprints(tables?: string[]) {
  const names =
    tables ??
    (
      await client.query<{ name: string }>(
        "SELECT format('%I.%I',n.nspname,c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','public') AND c.relkind='r' AND c.relname<>'cms_migrations' ORDER BY 1",
      )
    ).rows.map(r => r.name)
  const result: Record<string, string> = {}
  for (const table of names)
    result[table] = (
      await client.query(
        `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS value FROM ${table} t`,
      )
    ).rows[0]!.value
  return result
}
async function existingFunctionAccess() {
  return (
    await client.query(
      "SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','public_api') ORDER BY 1",
    )
  ).rows
}

beforeAll(async () => {
  admin = new Client({ connectionString: requireTestDatabase() })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  const parsed = new URL(requireTestDatabase())
  parsed.pathname = '/' + name
  url = parsed.href
  await migrate(url, { through: '0209_add_person_without_mail.sql' })
  client = new Client({ connectionString: url })
  await client.connect()
  await client.query(await readFile(new URL('../scripts/local-roles.sql', import.meta.url), 'utf8'))
  await client.query('INSERT INTO app_users(id,email,display_name) VALUES($1,$2,$3)', [
    actor,
    'upgrade@example.test',
    'Upgrade fixture',
  ])
  await client.query("INSERT INTO global_roles(user_id,role) VALUES($1,'super_admin')", [actor])
  await client.query("SELECT set_config('app.user_id',$1,false)", [actor])
  const site = (
    await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
      'upgrade',
      'Upgrade fixture',
      'resource',
      'upgrade.web.app',
      JSON.stringify({
        colors: { primary: '#003087', surface: '#ffffff', ink: '#1a1a1a' },
        fonts: { heading: 'Georgia', body: 'system-ui' },
        radius: '0.5rem',
      }),
      '[]',
    ])
  ).rows[0]!.id
  for (const table of ['themes', 'navigations', 'global_elements'])
    await client.query(`UPDATE ${table} SET published_version_id=draft_version_id WHERE site_id=$1`, [site])
  await client.query('UPDATE sites SET initial_release_required=false WHERE id=$1', [site])
  await client.query('SELECT app.rebuild_site_shell($1)', [site])
  const def = (
    await client.query(
      'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        'upgrade-hero',
        'Upgrade hero',
        'Test',
        '<h1>{{heading}}</h1>',
        '',
        '',
        JSON.stringify({
          nodes: [
            { kind: 'html', value: '<h1>' },
            { kind: 'slot', slotId: 'heading', slotKind: 'text', context: 'element-text' },
            { kind: 'html', value: '</h1>' },
          ],
          policyVersion: 4,
          cssPolicyVersion: 6,
        }),
        JSON.stringify([{ id: 'heading', kind: 'text', label: 'Heading', constraints: {} }]),
        'upgrade-hash',
        4,
        6,
        'Original fixture',
      ],
    )
  ).rows[0]!.section_def_id
  const page = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, '', 'Original published page']))
    .rows[0]!.id
  const draft = (
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      page,
      0,
      heroContent(def, 'Published fixture'),
      '{}',
    ])
  ).rows[0]!
  const published = (
    await client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [page, draft.revision, ...CHECKED_CLEAN])
  ).rows[0]!
  await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
    page,
    published.revision,
    heroContent(def, 'Later private fixture'),
    '{}',
  ])
  const person = (
    await client.query('SELECT app.provision_user($1,$2) AS id', ['editor@example.test', 'Editor fixture'])
  ).rows[0]!.id
  await client.query("SELECT app.set_site_membership($1,$2,'editor')", [person, site])
  await client.query("SELECT app.add_domain($1,'upgrade.example.org',false)", [site])
  await client.query(
    "UPDATE outbox SET status='dead',attempts=5,failed_at=now(),last_error='Preserve this failure' WHERE event_type IN ('domain.sync','site.hosting_requested')",
  )
  before = await fingerprints()
  access = await existingFunctionAccess()
  applied = await migrate(url)
})
afterAll(async () => {
  await client?.end()
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await admin.end()
  }
})

it('upgrades from 0209 with every existing application table byte-identical', async () => {
  expect(Object.keys(before).length).toBeGreaterThan(70)
  expect(await fingerprints(Object.keys(before))).toEqual(before)
  expect(applied.filter(x => !x.alreadyApplied).map(x => x.name)).toEqual(['0211_hosting_delivery_recovery.sql'])
  expect((await client.query('SELECT * FROM app.hosting_retry_receipts')).rows).toEqual([])
  expect(
    (await client.query("SELECT count(*) FROM outbox WHERE payload ? 'hosting_recovery_target'")).rows[0]!.count,
  ).toBe('0')
})
it('preserves every existing function owner and execute grant', async () => {
  const after = new Map((await existingFunctionAccess()).map((x: { signature: string }) => [x.signature, x]))
  for (const row of access as { signature: string }[]) expect(after.get(row.signature)).toEqual(row)
})
it('reruns through the migration ledger without new work or changed data', async () => {
  expect((await migrate(url)).every(x => x.alreadyApplied)).toBe(true)
  expect(await fingerprints(Object.keys(before))).toEqual(before)
  expect((await client.query('SELECT count(*) FROM app.hosting_retry_receipts')).rows[0]!.count).toBe('0')
})
