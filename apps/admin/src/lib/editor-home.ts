import 'server-only'
import { getStoriesWorkspace } from './stories-workspace.ts'
import { storiesCatalog } from './stories-catalog.ts'
import { storyListValues, type StoryListRow } from './story-list.ts'
import { hasStoryText } from './stories-model.ts'
import { storiesOverview } from './stories-overview.ts'
import { storyCalendarJobs } from './story-calendar-data.ts'
/** Existing RLS readers only. Never checks or refreshes a source feed. */
export async function editorialStoryHome(userId: string, siteId: string, slug: string) {
  const list = await getStoriesWorkspace(userId, siteId)
  if (!list) return null
  const rows: StoryListRow[] = list.entries
    .filter(row => !row.archived)
    .map(row => ({
      id: row.id!,
      stableKey: row.stableKey,
      values: storyListValues(row.values),
      published: row.publishedArchived || !row.publishedValues ? null : storyListValues(row.publishedValues),
      changed: JSON.stringify(row.values) !== JSON.stringify(row.publishedValues),
      hasText: hasStoryText(row.values),
      photoPreview: null,
    }))
  const settings = storiesCatalog(list.draft, slug)
  const published = storiesCatalog(list.published ?? list.draft, slug)
  const overview = storiesOverview(rows, settings, published)
  const jobs = await storyCalendarJobs(userId, siteId, list.id, rows)
  const month = new Date().toISOString().slice(0, 7)
  return {
    articlePaths: rows.flatMap(row => (typeof row.values.story_url === 'string' ? [row.values.story_url] : [])),
    missing: overview.missing.length,
    gaps: overview.groups.filter(group => group.live === 0).map(group => ({ id: group.id, label: group.label })),
    scheduled: new Set(
      jobs
        .filter(job => ['pending', 'running'].includes(job.status) && job.runAt.slice(0, 7) === month)
        .map(job => job.entryId),
    ).size,
    ready: Boolean(list.draft.presentation.stories),
  }
}
