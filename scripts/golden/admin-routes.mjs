import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client, root } from './local.mjs'
function pages(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? pages(join(directory, entry.name), prefix + '/' + entry.name)
      : entry.name === 'page.tsx'
        ? [prefix || '/']
        : [],
  )
}
/** Exercise one real instance of every read-only route pattern. One-time Auth
 * confirmation needs a real provider token and remains in the hosted demo walk. */
export async function adminRoutes(t, data) {
  const db = new Client({ connectionString: t.url })
  await db.connect()
  try {
    const sawso = data.routes.find(r => r.slug === 'sawso' && r.path === '/ways-we-help/education')
    const echelon = data.routes.find(r => r.slug === 'echelon-chapters' && r.path === '/')
    const definition = (
      await db.query("SELECT content->0->>'section_def_id' AS id FROM page_versions WHERE id=$1", [
        sawso.draft_version_id,
      ])
    ).rows[0].id
    const entry = (
      await db.query(
        "SELECT e.id FROM collection_entries e JOIN collections c ON c.id=e.collection_id WHERE c.site_id=$1 AND c.reader_key='stories' AND e.archived_at IS NULL ORDER BY e.sort_index,e.id LIMIT 1",
        [sawso.site_id],
      )
    ).rows[0]?.id
    if (!definition || !entry) throw Error('Expected seeded section/story examples for admin baseline.')
    const cases = pages(join(root, 'apps/admin/src/app'))
      .sort()
      .filter(pattern => pattern !== '/auth/confirm')
      .map(pattern => ({
        pattern,
        path: pattern
          .replace(
            '[siteId]',
            pattern.includes('/chapters') || pattern.endsWith('/outbox') || pattern.endsWith('/contact-messages')
              ? echelon.site_id
              : sawso.site_id,
          )
          .replace('[pageId]', sawso.page_id)
          .replace('[definitionId]', definition)
          .replace('[entryId]', entry),
        signedIn: pattern !== '/sign-in',
      }))
    for (const view of ['gaps', 'world', 'split', 'order', 'soon'])
      cases.push({
        pattern: 'stories?view=' + view,
        path: `/sites/${sawso.site_id}/stories?view=${view}`,
        signedIn: true,
      })
    for (const route of data.routes.filter(
      r =>
        (r.slug === 'echelon-chapters' && ['/', '/chapters/atlanta'].includes(r.path)) ||
        (r.slug === 'echelon' && r.path === '/'),
    ))
      cases.push({ pattern: `editor-${route.slug}-${route.path}`, path: '/pages/' + route.page_id, signedIn: true })
    return {
      cases,
      excluded: [
        {
          pattern: '/auth/confirm',
          reason: 'Requires a real one-time provider link and separately verified hosted Super admin sign-in.',
        },
      ],
    }
  } finally {
    await db.end()
  }
}
