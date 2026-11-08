// Local-only owner-source assembly; no reset, publishing, site settings or sample copy.
import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { Client } from 'pg'
import { installCoreLibrary } from './core-install.ts'
import { annualReportTemplate, type ReportSectionInput } from './report-template.ts'
const input = resolve(process.argv[2] ?? '')
const folder = dirname(input)
const receipt = resolve(folder, 'draft-receipt.json')
if (!input.endsWith('/.r8-progress/round3/report-page/source-content.json'))
  throw new Error('Use the private local report input.')
await access(resolve(folder, 'before.dump'))
try {
  await access(receipt)
  throw new Error('A report receipt already exists; inspect the current draft before continuing.')
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
}
const source = JSON.parse(await readFile(input, 'utf8')) as {
  title: string
  address: string
  parentAddress: string
  parts: ReportSectionInput[]
}
const owner = new Client({ connectionString: 'postgres://cms:cms@127.0.0.1:54329/cms_demo' })
const client = new Client({ connectionString: 'postgres://cms_admin_app:devpassword@127.0.0.1:54329/cms_demo' })
try {
  await owner.connect()
  await client.connect()
  const actor = (
    await owner.query(
      "SELECT u.id FROM app_users u JOIN global_roles r ON r.user_id=u.id WHERE u.email='admin@example.test' AND r.role='super_admin'",
    )
  ).rows[0]
  if (!actor) throw new Error('The existing demo administrator is missing.')
  await client.query('BEGIN')
  await client.query("SELECT set_config('app.user_id',$1,true)", [actor.id])
  const site = (
    await client.query(
      "SELECT id FROM sites WHERE slug='sawso' AND staging_hostname='sawso.staging.localhost' AND archived_at IS NULL",
    )
  ).rows[0]
  if (!site) throw new Error('The retained SAWSO demo is missing.')
  const parent = (
    await client.query('SELECT id FROM pages WHERE site_id=$1 AND slug=$2 AND archived_at IS NULL', [
      site.id,
      source.parentAddress,
    ])
  ).rows[0]
  if (!parent) throw new Error('The report index is missing.')
  const address = source.parentAddress + '/' + source.address
  if (
    (
      await client.query('SELECT id FROM pages WHERE site_id=$1 AND (slug=$2 OR (slug=$3 AND parent_page_id=$4))', [
        site.id,
        address,
        source.address,
        parent.id,
      ])
    ).rowCount
  )
    throw new Error('A report already uses this address; no page was overwritten.')
  const installed = await installCoreLibrary(client)
  const defs = (
    await client.query(
      "SELECT d.id,d.slug,d.name,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global'",
    )
  ).rows
  const content = annualReportTemplate(defs, source.parts)
  const pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site.id, address, source.title]))
    .rows[0].id
  let page = (await client.query('SELECT revision FROM pages WHERE id=$1', [pageId])).rows[0]
  await client.query('SELECT * FROM app.save_page_details($1,$2,$3,$4,$5,$6,$7)', [
    pageId,
    page.revision,
    source.title,
    address,
    parent.id,
    null,
    null,
  ])
  page = (await client.query('SELECT revision FROM pages WHERE id=$1', [pageId])).rows[0]
  const saved = (
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      pageId,
      page.revision,
      JSON.stringify(content),
      JSON.stringify({ title: source.title, description: '', noindex: true }),
    ])
  ).rows[0]
  const final = (
    await client.query('SELECT id,slug,revision,draft_version_id,published_version_id,status FROM pages WHERE id=$1', [
      pageId,
    ])
  ).rows[0]
  if (final.published_version_id !== null) throw new Error('The report must stay private.')
  await client.query('COMMIT')
  await writeFile(
    receipt,
    JSON.stringify(
      {
        page: final,
        sections: content.length,
        installed: { created: installed.created, updated: installed.updated, unchanged: installed.unchanged },
        saved,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    'Created one private report draft with ' +
      content.length +
      ' normal shared sections; existing pages and publications preserved.',
  )
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await client.end().catch(() => {})
  await owner.end().catch(() => {})
}
