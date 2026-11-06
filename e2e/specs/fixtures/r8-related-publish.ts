import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { coreTemplateContent } from '@cms/seeds/core-templates'
import { starterCollections, starterSiteSetup } from '@cms/seeds/archetypes'
export async function relatedPublishFixture() {
  const pool = new Pool({
      connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    client = await pool.connect(),
    suffix = randomUUID().slice(0, 8),
    host = `related-${suffix}.staging.localhost`
  let released = false
  try {
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const theme = (
      await client.query(
        "SELECT v.tokens FROM themes t JOIN theme_versions v ON v.id=t.published_version_id JOIN sites s ON s.id=t.site_id WHERE s.slug='demo'",
      )
    ).rows[0]!.tokens
    const site = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `related-${suffix}`,
        'Related review',
        'resource',
        host,
        JSON.stringify(theme),
        '[]',
      ])
    ).rows[0]!.id
    for (const list of starterCollections(starterSiteSetup('resource')))
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        site,
        list.slug,
        list.name,
        list.readerKey,
        JSON.stringify(list.model.fields),
        JSON.stringify(list.model.presentation),
      ])
    const definitions = (
      await client.query(
        "SELECT d.id,d.slug,d.name,v.version,v.slots FROM section_defs d JOIN LATERAL(SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug LIKE 'core-%'",
      )
    ).rows
    const pages: string[] = []
    for (const [slug, title, template] of [
      ['', 'Home for review', 'blank'],
      ['resources', 'Resources for review', 'resources'],
      ['notes', 'Unrelated private notes', 'blank'],
    ]) {
      const id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, title])).rows[0]!.id
      const content = coreTemplateContent(
        template!,
        definitions,
        title!,
        'A clear introduction reviewed by the local test coordinator.',
      )
      await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify(content),
        JSON.stringify({ description: 'A complete page for related publication review.' }),
      ])
      pages.push(id)
    }
    await client.query('SELECT app.save_navigation_draft($1,1,$2,$3)', [
      site,
      JSON.stringify(
        pages.slice(0, 2).map((id, index) => ({
          label: index ? 'Resources' : 'Home',
          target: { type: 'page', page_id: id },
          visible: true,
        })),
      ),
      'manual',
    ])
    await client.query('COMMIT')
    return { pool, site, pages, host }
  } catch (error) {
    await client.query('ROLLBACK')
    client.release()
    released = true
    await pool.end()
    throw error
  } finally {
    if (!released) client.release()
  }
}
