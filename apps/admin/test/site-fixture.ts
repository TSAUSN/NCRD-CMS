import { evaluateVersionReadiness, type Queryable } from '@cms/platform'

/** Explicit publication for tests whose subject is an already-live starter.
 * This fixture explicitly confirms authored starter examples, while refusing every other readiness defect.
 * Private creation and first release itself are tested in site-creation. */
export async function publishStarterFixture(client: Queryable, siteId: string) {
  const theme = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [siteId])).rows[0]!
  await client.query('SELECT app.publish_theme($1,$2)', [siteId, theme.revision])
  for (const schema of (await client.query('SELECT id,revision FROM collections WHERE site_id=$1', [siteId])).rows) {
    await client.query('SELECT app.publish_collection_schema($1,$2)', [schema.id, schema.revision])
  }
  const frame = (await client.query('SELECT kind,revision FROM global_elements WHERE site_id=$1', [siteId])).rows
  await client.query('SELECT app.publish_global_elements($1,$2,$3)', [
    siteId,
    frame.find(row => row.kind === 'header')!.revision,
    frame.find(row => row.kind === 'footer')!.revision,
  ])
  const pages = (
    await client.query(
      'SELECT id,revision,draft_version_id,slug FROM pages WHERE site_id=$1 ORDER BY length(slug),slug',
      [siteId],
    )
  ).rows
  const paths = pages.map(page => `/${page.slug}`)
  for (const page of pages) {
    const report = await evaluateVersionReadiness(client, page.draft_version_id, 'member', paths)
    if (report.blocking.some(finding => finding.rule !== 'sample_content'))
      throw new Error(report.blocking.map(finding => finding.message).join(' '))
    await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
      page.id,
      page.revision,
      report.policyVersion,
      report.blocking.length ? 'Confirmed: Publish with sample content.' : null,
      JSON.stringify(report.findings),
    ])
  }
  const nav = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [siteId])).rows[0]!
  await client.query('SELECT app.publish_navigation($1,$2)', [siteId, nav.revision])
}
