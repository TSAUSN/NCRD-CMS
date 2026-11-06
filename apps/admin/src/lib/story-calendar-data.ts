import 'server-only'
import { asUser } from '@cms/platform'
import type { ReleaseItem } from './releases.ts'
import type { StoryListRow } from './story-list.ts'
import type { StoryCalendarJob } from './story-calendar.ts'
/** Read existing timers under the same site/role rules as Publish. No refresh. */
export async function storyCalendarJobs(
  userId: string,
  siteId: string,
  collectionId: string,
  rows: StoryListRow[],
): Promise<StoryCalendarJob[]> {
  return asUser({ userId }, async client => {
    const jobs = (
      await client.query<{
        id: string
        item_type: string
        item_id: string
        run_at: Date
        status: StoryCalendarJob['status']
        snapshot: ReleaseItem[] | null
        path: string | null
      }>(
        `SELECT j.id,j.item_type,j.item_id,j.run_at,CASE WHEN sc.release_id IS NOT NULL AND j.status IN ('pending','running') AND app.story_release_fingerprint(j.site_id,r.snapshot) IS DISTINCT FROM sc.before_hash THEN 'needs_review' ELSE j.status::text END AS status,r.snapshot,app.page_path(p.page_slug) AS path FROM scheduled_actions j LEFT JOIN site_releases r ON j.item_type='release' AND r.id=j.item_id AND r.site_id=j.site_id LEFT JOIN site_release_story_scopes sc ON sc.release_id=r.id LEFT JOIN page_versions p ON j.item_type='page' AND p.id=j.version_id AND p.site_id=j.site_id WHERE j.site_id=$1 AND j.action='publish' AND j.status IN ('pending','running','succeeded','failed') ORDER BY j.run_at DESC,j.id LIMIT 200`,
        [siteId],
      )
    ).rows
    return jobs.flatMap(job => {
      const chosen =
        job.item_type === 'release'
          ? new Set(
              job.snapshot
                ?.filter(item => item.type === 'collection_entries' && item.id === collectionId)
                .flatMap(item => item.entryIds ?? []) ?? [],
            )
          : new Set(rows.filter(row => row.values.story_url === job.path).map(row => row.id))
      return rows
        .filter(row => chosen.has(row.id))
        .map(row => ({
          id: job.id,
          entryId: row.id,
          title: String(row.values.title || '[Untitled story]'),
          runAt: job.run_at.toISOString(),
          status: job.status,
          releaseId: job.item_type === 'release' ? job.item_id : null,
        }))
    })
  })
}
