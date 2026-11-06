import { suggestStoryTags, withStoryTagIds, type StoriesSettings } from '@cms/schema'
import { escapeText } from '@cms/renderer'
import { sawsoStoryRows } from '@cms/seeds/sawso-stories'
export const SAWSO_STORIES_FEED = 'https://sawso.org/sawso/story/symphony/json?start=0&limit=999'
export const STORY_SOURCE_FIELDS = ['title', 'summary', 'published_date', 'old_address', 'image_url'] as const
export type StorySourceField = (typeof STORY_SOURCE_FIELDS)[number]
export type StorySourceFields = Record<StorySourceField, string>
export type SourceStory = { sourceId: string; alias: string; fields: StorySourceFields }
export type StorySourceBaseline = { sourceId: string; stableKey: string; fields: StorySourceFields }
export type SourceMergeEntry = { id: string | null; stableKey: string; values: Record<string, unknown> }
export class StoryFeedFormatError extends Error {
  constructor() {
    super('The stories feed could not be read safely. Saved stories are unchanged.')
  }
}
const invalid = () => {
  throw new StoryFeedFormatError()
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) return invalid()
  return value.trim()
}
function address(value: string, empty = false): string {
  if (!value && empty) return ''
  if (!value.startsWith('https://') && !value.startsWith('/')) return invalid()
  let url: URL
  try {
    url = new URL(value, 'https://sawso.org')
  } catch {
    return invalid()
  }
  if (url.protocol !== 'https:' || url.username || url.password || value.length > 2048 || /[\\\s]/.test(value))
    return invalid()
  return value.startsWith('/') ? url.href : value
}
function flag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (
    value === undefined ||
    value === null ||
    value === false ||
    value === 'false' ||
    value === 0 ||
    value === '' ||
    value === '0'
  )
    return false
  return invalid()
}
/** Reference PHP uses form decoding once, then stable idx order and published/menu gates. */
export function parseSawsoStoriesFeed(wire: string): SourceStory[] {
  if (wire.length > 20_000_000) return invalid()
  let data: unknown
  try {
    data = JSON.parse(decodeURIComponent(wire.replace(/\+/g, ' ')))
  } catch {
    return invalid()
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { objects?: unknown }).objects)) return invalid()
  const objects = (data as { objects: unknown[] }).objects
  if (objects.length > 2000) return invalid()
  const chosen: { story: SourceStory; order: number; index: number }[] = [],
    seen = new Set<string>()
  for (const [index, item] of objects.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid()
    const row = item as Record<string, unknown>
    if (!flag(row.published) || flag(row.hideInMenu) || !row.id || !row.title) continue
    const sourceId =
      typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0
        ? String(row.id)
        : typeof row.id === 'string'
          ? row.id
          : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(sourceId) || seen.has(sourceId)) return invalid()
    seen.add(sourceId)
    const title = text(row.title, 500),
      summary = text(row.description || row.synopsis || '', 2000),
      date = text(row.publishDate ?? '', 100).slice(0, 10),
      parsed = new Date(date + 'T00:00:00Z')
    if (
      !title ||
      !summary ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      return invalid()
    const alias = text(row.urlAlias ?? '', 500),
      redirect = text(row.redirectUrl ?? '', 2048),
      link = address(redirect || 'https://sawso.org/sawso/story/' + alias),
      image = address(text(row.headerImage ?? '', 2048).replace(/[+ ]/g, '%20'), true)
    if (!redirect && !alias) return invalid()
    let order = 999
    try {
      const meta = JSON.parse(typeof row.customHeadContent === 'string' ? row.customHeadContent : ''),
        value = Number.parseFloat(String(meta?.idx))
      if (Number.isFinite(value)) order = value
    } catch {}
    chosen.push({
      index,
      order,
      story: { sourceId, alias, fields: { title, summary, published_date: date, old_address: link, image_url: image } },
    })
  }
  return chosen.sort((a, b) => a.order - b.order || a.index - b.index).map(item => item.story)
}
/** Only the approved CMS import snapshot supplies first-check baselines. Current drafts never do. */
export function initialSawsoSourceBaselines(existingKeys: readonly string[]): StorySourceBaseline[] {
  const keys = new Set(existingKeys)
  return sawsoStoryRows()
    .filter(row => keys.has(row.stableKey))
    .map(row => ({
      sourceId: row.stableKey.slice('story-'.length),
      stableKey: row.stableKey,
      fields: Object.fromEntries(
        STORY_SOURCE_FIELDS.map(field => [field, String(row.values[field as keyof typeof row.values] ?? '')]),
      ) as StorySourceFields,
    }))
}
function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64)
      .replace(/-$/, '') || 'story'
  )
}
function unused(base: string, used: Set<string>): string {
  let value = base,
    n = 2
  while (used.has(value)) value = base + '-' + n++
  used.add(value)
  return value
}
/** A baseline is the last source text, never a copy of the current CMS draft. */
export function mergeStorySource(
  entries: readonly SourceMergeEntry[],
  baselines: readonly StorySourceBaseline[],
  incoming: readonly SourceStory[],
  settings: StoriesSettings,
  occupiedPaths: readonly string[] = [],
  occupiedKeys: readonly string[] = [],
) {
  if (
    entries.length > 2000 ||
    incoming.length > 2000 ||
    new Set(entries.map(e => e.stableKey)).size !== entries.length ||
    new Set(baselines.map(b => b.sourceId)).size !== baselines.length ||
    new Set(baselines.map(b => b.stableKey)).size !== baselines.length
  )
    return invalid()
  const next = entries.map(entry => ({ ...entry, values: { ...entry.values } })),
    byKey = new Map(next.map(entry => [entry.stableKey, entry])),
    bySource = new Map(baselines.map(b => [b.sourceId, b])),
    nextBaselines = new Map(baselines.map(b => [b.sourceId, { ...b, fields: { ...b.fields } }])),
    seen = new Set<string>(),
    keys = new Set([...occupiedKeys, ...next.map(entry => entry.stableKey)]),
    paths = new Set(occupiedPaths.map(path => (path.startsWith('/') ? path : '/' + path))),
    newPages: { stableKey: string; path: string; title: string }[] = [],
    preserved: { sourceId: string; field: StorySourceField }[] = []
  for (const entry of next) if (typeof entry.values.story_url === 'string') paths.add(entry.values.story_url)
  let added = 0,
    updated = 0,
    removed = 0
  for (const story of incoming) {
    if (seen.has(story.sourceId)) return invalid()
    seen.add(story.sourceId)
    const baseline = bySource.get(story.sourceId)
    if (baseline) {
      const entry = byKey.get(baseline.stableKey)
      // A tracked archived story is deliberately absent from the active input. Never resurrect it.
      if (!entry) continue
      const before = JSON.stringify(entry.values)
      for (const field of STORY_SOURCE_FIELDS) {
        const current = entry.values[field] ?? ''
        if (current === baseline.fields[field]) {
          if (current !== story.fields[field]) entry.values[field] = story.fields[field]
        } else if (story.fields[field] !== baseline.fields[field]) preserved.push({ sourceId: story.sourceId, field })
      }
      if (entry.values.feed_removed === true) entry.values.feed_removed = false
      if (entry.values.in_feed === false) entry.values.in_feed = true
      if (JSON.stringify(entry.values) !== before) updated++
      nextBaselines.set(story.sourceId, {
        sourceId: story.sourceId,
        stableKey: entry.stableKey,
        fields: { ...story.fields },
      })
    } else {
      if (next.length >= 2000) return invalid()
      const stableKey = unused('feed-' + slug(story.sourceId), keys),
        alias = story.alias.split(/[?#]/)[0]!.split('/').filter(Boolean).at(-1) || story.fields.title,
        path = unused('/stories/' + slug(alias), paths),
        initial = {
          ...story.fields,
          body: '',
          body_is_sample: false,
          photo_is_sample: false,
          photo_note: '',
          countries: '',
          story_url: path,
          reviewed: false,
          hidden: false,
          feed_removed: false,
        },
        suggested = suggestStoryTags(initial, settings),
        values = withStoryTagIds(withStoryTagIds(initial, 'main', suggested.main), 'secondary', suggested.secondary)
      values.region_label = settings.secondaryTags
        .filter(tag => suggested.secondary.includes(tag.id))
        .map(tag => tag.label)
        .join(', ')
      values.sector_links = settings.mainTags
        .filter(tag => suggested.main.includes(tag.id))
        .map(tag =>
          paths.has('/ways-we-help/' + tag.id)
            ? '<a href="/ways-we-help/' + tag.id + '">' + escapeText(tag.label) + '</a>'
            : escapeText(tag.label),
        )
        .join(' ')
      next.push({ id: null, stableKey, values })
      nextBaselines.set(story.sourceId, { sourceId: story.sourceId, stableKey, fields: { ...story.fields } })
      newPages.push({ stableKey, path, title: story.fields.title })
      added++
    }
  }
  for (const baseline of baselines)
    if (!seen.has(baseline.sourceId)) {
      const entry = byKey.get(baseline.stableKey)
      if (entry && entry.values.feed_removed !== true && entry.values.in_feed !== false) {
        entry.values.feed_removed = true
        removed++
      }
    }
  return {
    entries: next,
    baselines: [...nextBaselines.values()],
    newPages,
    preserved,
    added,
    updated,
    removed,
    total: incoming.length,
    changed: added + updated + removed > 0,
  }
}
