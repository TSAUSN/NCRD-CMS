// `pnpm db:seed` — a working local environment: three section definitions, one
// site, one published page, and three people at different capability tiers.
//
// Everything goes through the same commands the product uses, so the seed is
// also a smoke test of the command surface. The single exception is the first
// super admin: there is nobody to authorize that, so the migration owner
// inserts it, exactly as an operator would bootstrap a hosted project.
import { installCoreLibrary } from './core-install.ts'
import { Client, type QueryResultRow } from 'pg'
import { evaluateVersionReadiness } from '@cms/platform'
import {
  SEED_SECTION_DEFS,
  compileSeedSection,
  demoHomeContent,
  demoNavigation,
  demoSiteMeta,
  demoTheme,
  upsertArguments,
} from './index.ts'

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('DATABASE_URL is required (the migration-owner connection).')
  process.exit(1)
}
// The seed creates fixture people, including a super admin. Hosted databases get
// their first owner from scripts/bootstrap-hosted-owner.mjs instead.
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  console.error('The demo seed runs only against a local database (127.0.0.1 or localhost).')
  process.exit(1)
}

const ROOT_EMAIL = process.env['SEED_ROOT_EMAIL'] ?? 'root@example.test'
const client = new Client({ connectionString: url })
await client.connect()

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    await client.query('SELECT set_config($1,$2,true)', ['app.user_id', userId])
    const result = await fn()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

const one = async <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> =>
  (await client.query<T>(sql, params)).rows[0]!

try {
  const existing = await client.query<{ id: string }>('SELECT id FROM app_users WHERE email = $1', [ROOT_EMAIL])
  let rootId = existing.rows[0]?.id
  if (!rootId) {
    rootId = (
      await one<{ id: string }>(
        'INSERT INTO app_users (email, display_name, auth_subject) VALUES ($1,$2,$3) RETURNING id',
        [ROOT_EMAIL, 'Root', `local|${ROOT_EMAIL}`],
      )
    ).id
    await client.query("INSERT INTO global_roles (user_id, role) VALUES ($1,'super_admin')", [rootId])
  }
  console.log(`super admin: ${ROOT_EMAIL} (${rootId})`)

  await asUser(rootId, () => installCoreLibrary(client))

  const already = await client.query('SELECT id FROM sites WHERE slug = $1', [demoSiteMeta.slug])
  if (already.rows.length > 0) {
    console.log(`site "${demoSiteMeta.slug}" already exists — nothing to seed`)
    await client.end()
    process.exit(0)
  }

  const defIds = await asUser(rootId, async () => {
    const ids: Record<string, string> = {}
    for (const def of SEED_SECTION_DEFS) {
      const compiled = compileSeedSection(def)
      if (compiled.problems.length > 0) {
        throw new Error(`seed section ${def.slug} does not compile cleanly: ${compiled.problems.join('; ')}`)
      }
      // One call for both models. The arguments are built where the definitions
      // live, so the discriminator, the compiled artifacts and the document are
      // assembled together rather than by a caller deciding which fields to fill
      // in for which kind (migration 0019).
      const row = await one<{ section_def_id: string }>(
        'SELECT section_def_id FROM app.upsert_section_def_version' +
          '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        upsertArguments(def),
      )
      ids[def.slug] = row.section_def_id
    }
    return ids
  })
  console.log(`section definitions: ${Object.keys(defIds).join(', ')}`)

  const { siteId, pageId } = await asUser(rootId, async () => {
    const site = await one<{ id: string }>('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
      demoSiteMeta.slug,
      demoSiteMeta.name,
      demoSiteMeta.kind,
      demoSiteMeta.stagingHostname,
      JSON.stringify(demoTheme),
      JSON.stringify(demoNavigation),
    ])
    const page = await one<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
      site.id,
      demoSiteMeta.page.slug,
      demoSiteMeta.page.title,
    ])
    return { siteId: site.id, pageId: page.id }
  })

  await asUser(rootId, async () => {
    // This operator-invoked demo seed deliberately publishes its example site.
    // Product site creation now leaves these same artifacts private.
    await client.query('SELECT app.publish_theme($1,1)', [siteId])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [siteId])
    const draft = await one<{ version_id: string }>('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      pageId,
      0,
      JSON.stringify(demoHomeContent(defIds)),
      JSON.stringify(demoSiteMeta.page.meta),
      'checkpoint',
      'Seeded home page',
    ])

    // Use the same readiness evaluator as editor publication so invalid seed content fails here.
    const readiness = await evaluateVersionReadiness(client, draft.version_id, 'member')
    if (!readiness.ok) {
      throw new Error(`the seeded home page is not publishable: ${readiness.blocking.map(f => f.rule).join(', ')}`)
    }

    const published = await one<{ path: string; revision: string }>(
      'SELECT path, revision FROM app.publish_page($1,$2,$3,$4,$5)',
      [pageId, 1, readiness.policyVersion, null, JSON.stringify(readiness.findings)],
    )
    console.log(`published ${published.path} at revision ${published.revision}`)
    const navigation = await one<{ revision: string }>('SELECT revision FROM navigations WHERE site_id=$1', [siteId])
    await client.query('SELECT app.publish_navigation($1,$2)', [siteId, navigation.revision])
  })

  // Two more people so the capability tiers are visible without inviting anyone.
  await asUser(rootId, async () => {
    for (const [email, name, role] of [
      ['editor@example.test', 'Demo Editor', 'editor'],
      ['contributor@example.test', 'Demo Contributor', 'contributor'],
    ] as const) {
      const user = await one<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [email, name])
      await client.query('SELECT app.set_site_membership($1,$2,$3)', [user.id, siteId, role])
      await client.query('UPDATE app_users SET auth_subject = $1 WHERE id = $2', [`local|${email}`, user.id])
      console.log(`${role}: ${email}`)
    }
  })

  console.log(`\nsite ${siteId} is live at http://${demoSiteMeta.stagingHostname}:3001/`)
} finally {
  await client.end()
}
