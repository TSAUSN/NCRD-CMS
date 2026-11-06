import { asUser, type Queryable } from '@cms/platform'
import { sawsoStoryRows } from '@cms/seeds/sawso-stories'
import { ECHELON_CHAPTER_SOURCES } from '@cms/seeds/echelon-chapters'
import { DomainError } from '@cms/domain'
import { previewRedirectCsv, type RedirectImportRow, type RedirectPage, type RedirectRow } from './redirect-import.ts'
export async function redirectWorkspace(client: Queryable, siteId: string) {
  const pages = (
    await client.query<RedirectPage>(
      `SELECT p.id,p.title,'/'||p.slug AS path,(SELECT path FROM published_routes WHERE site_id=p.site_id AND page_id=p.id ORDER BY path LIMIT 1) AS "publishedPath" FROM pages p WHERE p.site_id=$1 AND p.archived_at IS NULL ORDER BY lower(p.title),p.id`,
      [siteId],
    )
  ).rows
  const rows = (
    await client.query<RedirectRow>(
      `SELECT r.id,r.revision,r.old_path AS "oldPath",r.page_id AS "pageId",p.title,(SELECT path FROM published_routes WHERE site_id=r.site_id AND page_id=r.page_id ORDER BY path LIMIT 1) AS "publishedPath" FROM site_redirects r JOIN pages p ON p.site_id=r.site_id AND p.id=r.page_id WHERE r.site_id=$1 ORDER BY r.old_path`,
      [siteId],
    )
  ).rows
  return { pages, rows }
}
export function getRedirectWorkspace(userId: string, siteId: string) {
  return asUser({ userId }, client => redirectWorkspace(client, siteId))
}
/** Install only missing mappings backed by the maintainer’s CSV; edited mappings stay. */
export async function ensureChapterRedirects(client: Queryable, siteId: string) {
  const data = await redirectWorkspace(client, siteId),
    finder = data.pages.find(page => page.path === '/chapters')
  const mappings = ECHELON_CHAPTER_SOURCES.map(source => ({
    oldPath: '/chapter/' + source.sourcePath.trim().toLowerCase(),
    page: data.pages.find(page => page.path === '/chapters/' + source.slug),
  }))
  if (finder) mappings.push({ oldPath: '/chapter', page: finder })
  const sources = new Map<string, number>()
  for (const mapping of mappings) sources.set(mapping.oldPath, (sources.get(mapping.oldPath) ?? 0) + 1)
  for (const mapping of mappings) {
    if (
      !mapping.page ||
      sources.get(mapping.oldPath) !== 1 ||
      !/^\/chapter(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(mapping.oldPath) ||
      data.rows.some(row => row.oldPath === mapping.oldPath)
    )
      continue
    await client.query('SELECT app.save_site_redirect($1,NULL,0,$2,$3)', [siteId, mapping.oldPath, mapping.page.id])
  }
}

/** The approved old story paths follow native page IDs and preserve edited mappings. */
export async function ensureSawsoRedirects(client: Queryable, siteId: string): Promise<number> {
  if (!(await client.query('SELECT app.can_administer_site($1) AS allowed', [siteId])).rows[0]?.allowed)
    throw new DomainError('not_authorized', 'A site administrator manages redirects.')
  const data = await redirectWorkspace(client, siteId)
  let created = 0
  for (const story of sawsoStoryRows()) {
    const oldPath = new URL(story.values.old_address).pathname,
      page = data.pages.find(page => page.path === story.values.story_url)
    if (!page)
      throw new DomainError('invalid_state', 'Create the native story destinations before adding their old addresses.')
    if (data.rows.some(row => row.oldPath === oldPath)) continue
    await client.query('SELECT app.save_site_redirect($1,NULL,0,$2,$3)', [siteId, oldPath, page.id])
    created++
  }
  return created
}

export async function importRedirectsInTransaction(
  client: Queryable,
  siteId: string,
  source: string,
  expected: Pick<RedirectImportRow, 'oldPath' | 'id' | 'revision'>[],
): Promise<number> {
  if (!(await client.query('SELECT app.can_administer_site($1) AS allowed', [siteId])).rows[0]?.allowed)
    throw new DomainError('not_authorized', 'A site administrator imports redirects.')
  await client.query('SELECT app.lock_release_site($1)', [siteId])
  const data = await redirectWorkspace(client, siteId)
  let plan: RedirectImportRow[]
  try {
    plan = previewRedirectCsv(source, data.pages, data.rows)
  } catch (error) {
    throw new DomainError('invalid_state', (error as Error).message)
  }
  if (!Array.isArray(expected) || plan.length !== expected.length)
    throw new DomainError('stale_revision', 'Preview the spreadsheet again before importing.')
  for (const row of plan) {
    if (row.issue) throw new DomainError('invalid_state', 'Row ' + row.line + ': ' + row.issue)
    const previous = expected.find(item => item.oldPath === row.oldPath)
    if (!previous || previous.id !== row.id || previous.revision !== row.revision)
      throw new DomainError('stale_revision', 'A redirect changed. Preview the spreadsheet again.')
  }
  let count = 0
  for (const row of plan.sort((a, b) => a.oldPath.localeCompare(b.oldPath))) {
    if (row.unchanged) continue
    await client.query('SELECT app.save_site_redirect($1,$2,$3,$4,$5)', [
      siteId,
      row.id,
      row.revision,
      row.oldPath,
      row.pageId,
    ])
    count++
  }
  return count
}
