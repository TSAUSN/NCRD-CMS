import { storyDateInFeed, storyTagIds, storyAllowedInFeeds, type StoriesSettings } from '@cms/schema'
import { STORY_SECTORS, STORY_REGIONS } from '@cms/seeds/sawso-stories'
import { selectListRows } from './collection-binding.ts'
export { STORY_SECTORS, STORY_REGIONS }
export type StoryRecord = {
  id: string | null
  stableKey: string
  values: Record<string, unknown>
  archived?: boolean
  editedAt?: string
}
const iso = (date: Date) => date.toISOString().slice(0, 10)
const day = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
function addMonths(date: Date, count: number) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1))
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(date.getUTCDate(), last))
  return result
}
export function storyTags(values: Record<string, unknown>, settings?: StoriesSettings): string[] {
  return storyTagIds(values, 'main').filter(id => (settings?.mainTags ?? STORY_SECTORS).some(t => t.id === id))
}
export function hasStoryText(values: Record<string, unknown>): boolean {
  return (
    typeof values.body === 'string' &&
    values.body
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/g, ' ')
      .trim().length > 0
  )
}
export function storyFeedState(record: StoryRecord, now = new Date()) {
  const row = { ...record, id: record.id ?? record.stableKey, createdAt: record.editedAt ?? '1970-01-01' }
  const selection = { mode: 'automatic' as const, dateField: 'published_date', maxAgeMonths: 13, limit: 200 }
  const today = day(now)
  const published = typeof record.values.published_date === 'string' ? record.values.published_date : ''
  const date = new Date(published + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published) || !Number.isFinite(date.getTime()) || iso(date) !== published)
    return { active: false, leavesOn: '', days: 0, soon: false }
  const active = storyDateInFeed(published, today)
  let end = addMonths(date, 13)
  // Match the same clamped calendar-month cutoff used at publication.
  for (let n = 0; n < 31; n++) {
    const next = new Date(end)
    next.setUTCDate(next.getUTCDate() + 1)
    if (!selectListRows([row], selection, next).length) break
    end = next
  }
  const days = Math.round((end.getTime() - today.getTime()) / 86400000)
  return { active, leavesOn: iso(end), days, soon: active && days < 60 }
}
export function storyDate(value: string): string {
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
        date,
      )
    : 'Date needed'
}
export function storiesSummary(entries: readonly StoryRecord[], now = new Date(), settings?: StoriesSettings) {
  const rows = entries
    .filter(e => !e.archived)
    .map(entry => ({
      ...entry,
      tags: storyTags(entry.values, settings),
      feed: storyFeedState(entry, now),
      hasText: hasStoryText(entry.values),
    }))
    .sort((a, b) => String(b.values.published_date ?? '').localeCompare(String(a.values.published_date ?? '')))
  const active = rows.filter(row => row.feed.active && (!settings || storyAllowedInFeeds(row.values, settings)))
  return {
    rows,
    textNeeded: rows.filter(row => !row.hasText).length,
    sampleText: rows.filter(row => row.hasText && row.values.body_is_sample === true).length,
    sectors: (settings?.mainTags ?? STORY_SECTORS)
      .map(s => ({ ...s, count: active.filter(row => row.tags.includes(s.id)).length }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    regions: (settings?.secondaryTags ?? STORY_REGIONS).map(r => ({
      ...r,
      count: active.filter(row => storyTagIds(row.values, 'secondary').includes(r.id)).length,
    })),
    soon: rows.filter(r => r.feed.soon).sort((a, b) => a.feed.days - b.feed.days),
  }
}
