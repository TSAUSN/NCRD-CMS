import 'server-only'
import { nationalTemplateEligibilitySql } from '../../lib/site-installation-settings.ts'
import { asUser } from '@cms/platform'
import { SITE_DIRECTORY_SQL, SITE_SUMMARY_SQL } from '../../lib/site-summary.ts'
import { REVIEWED_PAGE_CANVAS_SQL } from '../../lib/reviewed-page-canvas.ts'
import { UUID_SHAPE } from './record-id.ts'

export type SiteRow = {
  id: string
  slug: string
  name: string
  status: string
  staging_hostname: string | null
  primary_hostname?: string | null
  hosting_status?: string
  initial_release_required?: boolean
  has_published_pages?: boolean
  original_design?: boolean
  has_isolated_page_canvas?: boolean
  chapters_enabled?: boolean
  has_stories?: boolean
  has_content_lists?: boolean
  national_template?: boolean
}

/**
 * A site plus the two counts a dashboard card is worth showing.
 *
 * Counted rather than invented. Both come from the same `pages` rows the site
 * screen lists, under the same RLS, so a card saying "3 pages · 1 published"
 * and the list you reach by clicking it cannot disagree — and a site whose pages
 * this reader cannot see reads as zero rather than as a number they have no way
 * to check.
 */
export type SiteSummaryRow = SiteRow & {
  /** The starter the site began from: `resource`, `event` or `blank`. */
  kind?: string | null
  page_count: string
  story_count?: string
  preview_image?: string | null
  published_count: string
  draft_only_count: string
  changed_count: string
  has_stories?: boolean
}

/** Every read runs as the user's own database role; RLS decides what comes back. */
export function listSites(userId: string): Promise<SiteSummaryRow[]> {
  return asUser({ userId }, async client => (await client.query<SiteSummaryRow>(SITE_SUMMARY_SQL)).rows)
}

export function listSiteDirectory(userId: string): Promise<SiteSummaryRow[]> {
  return asUser({ userId }, async client => (await client.query<SiteSummaryRow>(SITE_DIRECTORY_SQL)).rows)
}

export function getSite(userId: string, siteId: string): Promise<SiteRow | null> {
  if (!UUID_SHAPE.test(siteId)) return Promise.resolve(null)
  return asUser(
    { userId },
    async client =>
      (
        await client.query<SiteRow>(
          `SELECT s.id, s.slug, s.name, s.status, s.staging_hostname, s.initial_release_required, s.chapters_enabled, ${nationalTemplateEligibilitySql()} AS national_template, EXISTS(SELECT 1 FROM collections c WHERE c.site_id=s.id AND c.reader_key='stories') AS has_stories, EXISTS(SELECT 1 FROM collections c WHERE c.site_id=s.id AND c.reader_key IS DISTINCT FROM 'stories') AS has_content_lists, CASE WHEN app.has_site_access(s.id) THEN app.site_hosting_status(s.id) ELSE 'ready' END AS hosting_status,
        (SELECT d.hostname_normalized FROM domains d WHERE d.site_id=s.id AND d.kind='primary'
          AND d.status='live' AND d.removed_at IS NULL LIMIT 1) AS primary_hostname,
        EXISTS(SELECT 1 FROM pages p WHERE p.site_id=s.id AND p.published_version_id IS NOT NULL
          AND p.archived_at IS NULL) AS has_published_pages,
        EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id
          WHERE h.site_id=s.id AND v.bundle ? 'original') AS original_design,
        ${REVIEWED_PAGE_CANVAS_SQL} AS has_isolated_page_canvas
       FROM sites s WHERE s.id = $1`,
          [siteId],
        )
      ).rows[0] ?? null,
  )
}
