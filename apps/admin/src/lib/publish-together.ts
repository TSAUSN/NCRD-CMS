// Publishing a page that links to pages which are not live yet, or the first
// page of a site that has never been published, used to stop at "fix the items
// below" — with nothing an editor could fix. What fixes it is publishing the
// other pages (and, the first time, the site's design, header, footer and menu)
// at the same moment. The release machinery already does exactly that, all or
// nothing (releases.ts); this works out what belongs in the release.
import { evaluateVersionReadiness, type Queryable } from '@cms/platform'
import type { ReadinessReport } from '@cms/domain'
import type { ReleaseItem } from './releases.ts'
import { renderPage } from '@cms/renderer'
import { readSitePreview } from './site-preview.ts'
import { SCRIPTLESS_RENDER_OPTIONS } from './scriptless-preview.ts'
import type { PublishTogether, TogetherPage } from './publish-together-copy.ts'
export {
  administratorNeededMessage,
  needsAdministrator,
  publishTogetherLabel,
  publishTogetherMessage,
  type PublishTogether,
  type TogetherPage,
} from './publish-together-copy.ts'

const SITE_WIDE: ReleaseItem['type'][] = ['theme', 'navigation', 'frame']

/** The path a readiness finding's link names, as the readiness rule compares it. */
function linkedPath(href: string): string {
  const path = href
    .split('?')[0]!
    .split('#')[0]!
    .replace(/(.)\/$/, '$1')
  return path === '' ? '/' : path
}

/**
 * The pages and site-wide parts that must go live with this page so that
 * publishing it leaves no visitor on a missing page: the unpublished pages it
 * links to, the unpublished pages those link to, and so on. Null when the page
 * is held back by anything that publishing more cannot fix — a missing heading,
 * an undescribed image, a link to a page that does not exist.
 */
export async function publishTogetherPlan(
  client: Queryable,
  pageId: string,
  report: ReadinessReport,
): Promise<PublishTogether | null> {
  // Samples still require explicit consent at execution; they do not prevent
  // planning the dependencies needed for a first release.
  if (report.blocking.some(finding => finding.rule !== 'broken_internal_link' && finding.rule !== 'sample_content'))
    return null
  const site = (
    await client.query<{ site_id: string; first: boolean; path: string }>(
      `SELECT p.site_id, s.initial_release_required AS first, app.page_path(p.slug) AS path
       FROM pages p JOIN sites s ON s.id = p.site_id WHERE p.id = $1`,
      [pageId],
    )
  ).rows[0]
  if (!site) return null
  const waiting = new Map(
    (
      await client.query<TogetherPage & { draft: string }>(
        `SELECT id, title, app.page_path(slug) AS path, draft_version_id AS draft FROM pages
      WHERE site_id = $1 AND id <> $2 AND archived_at IS NULL
        AND draft_version_id IS NOT NULL AND published_version_id IS NULL`,
        [site.site_id, pageId],
      )
    ).rows.map(row => [row.path, row]),
  )

  const chosen = new Map<string, TogetherPage>()
  let collections = false
  let links = report.blocking
    .filter(finding => finding.rule === 'broken_internal_link')
    .map(finding => linkedPath(finding.detail ?? ''))
  if (site.first) {
    // Readiness initially sees the published shell. The first release replaces
    // it with saved shared content: include private pages those links need too.
    // Render through the same frame implementation, so preset brand links,
    // authored footer links and governed navigation follow one contract.
    const preview = await readSitePreview(client, site.site_id, 'draft')
    if (preview) {
      const frame = renderPage({
        shell: preview.shell,
        navigationPaths: preview.navigationPaths,
        isStaging: true,
        manifest: { page: { id: pageId, version_id: pageId, title: '', path: site.path }, meta: {}, sections: [] },
        options: SCRIPTLESS_RENDER_OPTIONS,
      }).html
      links.push(
        ...[...frame.matchAll(/<a\b[^>]*\bhref="(\/[^"<>]*)"/g)]
          .map(match => linkedPath(match[1]!))
          .filter(path => waiting.has(path)),
      )
    }
  }
  // The page's own links must all lead somewhere that will exist. A linked
  // page's further links are followed when they can be; one that cannot is
  // reported by the release check, naming the page it is on.
  if (links.some(path => path !== site.path && !waiting.has(path))) return null
  while (links.length) {
    const next: string[] = []
    for (const path of links) {
      const page = waiting.get(path)
      if (!page || chosen.has(page.id)) continue
      chosen.set(page.id, { id: page.id, title: page.title, path: page.path })
      // A page that lists a collection nobody has published yet cannot be
      // drawn until the collection goes live too; that is the one refusal
      // expected here, and it is answered by publishing the site's lists with
      // it. The savepoint keeps the refusal from ending the transaction.
      await client.query('SAVEPOINT publish_together_check')
      try {
        const its = await evaluateVersionReadiness(client, page.draft, 'member')
        await client.query('RELEASE SAVEPOINT publish_together_check')
        next.push(
          ...its.blocking
            .filter(finding => finding.rule === 'broken_internal_link')
            .map(finding => linkedPath(finding.detail ?? '')),
        )
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT publish_together_check')
        collections = true
      }
    }
    links = next
  }
  if (!chosen.size && !site.first) return null
  return { siteId: site.site_id, pages: [...chosen.values()], siteWide: site.first, collections }
}

/** The release items for a plan, or null when one of its pages changed since. */
export function publishTogetherItems(
  candidates: ReleaseItem[],
  pageId: string,
  plan: PublishTogether,
): ReleaseItem[] | null {
  const pages = new Set([pageId, ...plan.pages.map(page => page.id)])
  const items = candidates.filter(
    item =>
      (item.type === 'page' && pages.has(item.id)) ||
      (plan.siteWide && SITE_WIDE.includes(item.type)) ||
      (plan.collections && (item.type === 'collection_schema' || item.type === 'collection_entries')),
  )
  return items.filter(item => item.type === 'page').length === pages.size ? items : null
}
