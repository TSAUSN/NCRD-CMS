import type { Queryable } from '@cms/platform'
import { SiteSetup } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { SAWSO_APPROVED, STORIES_MODEL, sawsoStoryRows } from '@cms/seeds/sawso-stories'
import { createSiteFromSetupInTransaction } from './site-creation.ts'

function sawsoSiteSetup(slug = 'sawso'): SiteSetup {
  const base = starterSiteSetup('resource'),
    wordmark = 'The Salvation Army World Service Office'
  return SiteSetup.parse({
    ...base,
    name: 'SAWSO',
    slug,
    theme: SAWSO_THEME,
    header: { ...base.header, brand: { ...base.header.brand, siteName: wordmark } },
    footer: { ...base.footer, brand: { ...base.footer.brand, siteName: wordmark, showFoundation: false } },
    pages: [
      {
        slug: '',
        title: 'Home',
        template: 'blank',
        layout: 'content',
        intro: SAWSO_APPROVED.pages['hub-overview'].paragraphs[0],
        body: '',
        menu: true,
        nested: false,
        footer: false,
      },
    ],
  })
}
/** Site initialization only. A retry never replaces an editor's saved story. */
export async function ensureSawsoSite(
  client: Queryable,
  requestId: string,
  slug = 'sawso',
): Promise<{ siteId: string; hostname: string; collectionId: string }> {
  if (!(await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed)
    throw new Error('Only a Super Admin can initialize this site.')
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,8))', ['cms-site-setup-' + slug])
  const found = (
    await client.query('SELECT id,staging_hostname FROM sites WHERE slug=$1 AND archived_at IS NULL', [slug])
  ).rows[0]
  if (found) {
    const list = await ensureStoriesList(client, found.id)
    return { siteId: found.id, hostname: found.staging_hostname, collectionId: list }
  }
  await installCoreLibrary(client)
  const setup = sawsoSiteSetup(slug),
    site = await createSiteFromSetupInTransaction(client, requestId, setup, slug + '.staging.localhost')
  const collectionId = await ensureStoriesList(client, site.siteId)
  return { ...site, collectionId }
}
export async function ensureStoriesList(client: Queryable, siteId: string): Promise<string> {
  const existing = (
    await client.query(
      "SELECT c.id,c.revision,c.draft_schema_version_id,c.published_schema_version_id,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.reader_key='stories'",
      [siteId],
    )
  ).rows[0]
  if (existing) {
    // A new story has no old source address. Upgrade only this known field on
    // a list with no private field changes, through the normal schema commands.
    const fields = Array.isArray(existing.fields) ? existing.fields : existing.fields?.fields
    if (
      existing.draft_schema_version_id === existing.published_schema_version_id &&
      Array.isArray(fields) &&
      fields.some((field: { key: string; required?: boolean }) => field.key === 'old_address' && field.required)
    ) {
      const updated = fields.map((field: { key: string }) =>
        field.key === 'old_address' ? { ...field, required: false } : field,
      )
      const saved = (
        await client.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
          existing.id,
          existing.revision,
          JSON.stringify(updated),
          JSON.stringify(existing.sort),
        ])
      ).rows[0]!
      await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [existing.id, saved.revision])
    }
    return existing.id
  }
  const list = (
    await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
      siteId,
      'stories',
      'Stories',
      'stories',
      JSON.stringify(STORIES_MODEL.fields),
      JSON.stringify(STORIES_MODEL.presentation),
    ])
  ).rows[0]!
  await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
    list.collection_id,
    list.entry_revision,
    JSON.stringify(sawsoStoryRows()),
  ])
  return list.collection_id
}
