import { z } from 'zod'

/** Closed, site-owned settings; stored in immutable collection model versions. */
export const STORY_MAP_AREAS = [
  'north-america',
  'latin-america-caribbean',
  'europe',
  'africa',
  'asia',
  'oceania',
] as const
const label = z.string().trim().min(1).max(80)
export const StoriesSetupInput = z
  .object({ mainLabel: label, secondaryLabel: label, publishUnreviewed: z.boolean() })
  .strict()
const tagId = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const unique = <T>(items: readonly T[]) => new Set(items).size === items.length
/** At least one selected tag in each nonempty group; empty means any. */
export const StoryTagFilter = z
  .object({
    main: z.array(tagId).max(100).refine(unique, 'Choose each main tag once.'),
    secondary: z.array(tagId).max(100).refine(unique, 'Choose each secondary tag once.'),
  })
  .strict()
export type StoryTagFilter = z.infer<typeof StoryTagFilter>
export const StoryMainTag = z
  .object({
    id: tagId,
    label,
    keywords: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .refine(v => unique(v.map(k => k.toLocaleLowerCase('en-US'))), 'Keywords must be unique.'),
  })
  .strict()
export const StorySecondaryTag = StoryMainTag.extend({
  areas: z.array(z.enum(STORY_MAP_AREAS)).max(6).refine(unique, 'Map areas must be unique.'),
}).strict()
export const StoriesSettings = z
  .object({
    schemaVersion: z.literal(1),
    mainLabel: label,
    secondaryLabel: label,
    mainTags: z
      .array(StoryMainTag)
      .max(100)
      .refine(v => unique(v.map(t => t.id)), 'Main tag IDs must be unique.'),
    secondaryTags: z
      .array(StorySecondaryTag)
      .max(100)
      .refine(v => unique(v.map(t => t.id)), 'Secondary tag IDs must be unique.'),
    publishUnreviewed: z.boolean(),
    source: z.enum(['none', 'sawso']),
  })
  .strict()
export type StoriesSettings = z.infer<typeof StoriesSettings>
/** Only display metadata may travel with a public Story binding. */
export const StoryCatalog = z
  .object({
    mainLabel: label,
    secondaryLabel: label,
    newsroomOrder: z.boolean().optional(),
    sectorPageLimit: z.literal(6).optional(),
    mainTags: z
      .array(StoryMainTag.omit({ keywords: true }))
      .max(100)
      .refine(v => unique(v.map(t => t.id))),
    secondaryTags: z
      .array(StorySecondaryTag.omit({ keywords: true }))
      .max(100)
      .refine(v => unique(v.map(t => t.id))),
  })
  .strict()
export type StoryCatalog = z.infer<typeof StoryCatalog>
export function storyCatalog(settings: StoriesSettings): StoryCatalog {
  return {
    mainLabel: settings.mainLabel,
    secondaryLabel: settings.secondaryLabel,
    ...(settings.source === 'sawso' ? { sectorPageLimit: 6 as const } : {}),
    mainTags: settings.mainTags.map(({ id, label }) => ({ id, label })),
    secondaryTags: settings.secondaryTags.map(({ id, label, areas }) => ({ id, label, areas: [...areas] })),
  }
}
export type StoryTagGroup = 'main' | 'secondary'
export function emptyStoriesSettings(): StoriesSettings {
  return {
    schemaVersion: 1,
    mainLabel: 'Main tags',
    secondaryLabel: 'Secondary tags',
    mainTags: [],
    secondaryTags: [],
    publishUnreviewed: true,
    source: 'none',
  }
}

/** Shared UTC calendar window, matching the database's clamped13-month cutoff. */
export function storyDateInFeed(value: unknown, now = new Date()): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(now.getTime())) return false
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, 1))
  const last = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate()
  cutoff.setUTCDate(Math.min(now.getUTCDate(), last))
  return value >= cutoff.toISOString().slice(0, 10) && value <= now.toISOString().slice(0, 10)
}

/** Existing single-region records remain readable without mutating saved data. */
export function storyTagIds(values: Record<string, unknown>, group: StoryTagGroup): string[] {
  const value =
    group === 'main'
      ? values.tags
      : typeof values.regions === 'string' && values.regions.trim()
        ? values.regions
        : values.region
  return typeof value === 'string'
    ? [
        ...new Set(
          value
            .split(',')
            .map(v => v.trim())
            .filter(Boolean),
        ),
      ]
    : []
}
export function withStoryTagIds(
  values: Record<string, unknown>,
  group: StoryTagGroup,
  ids: readonly string[],
): Record<string, unknown> {
  const uniqueIds = [...new Set(ids)]
  return group === 'main'
    ? { ...values, tags: uniqueIds.join(',') }
    : { ...values, regions: uniqueIds.join(','), region: uniqueIds[0] ?? '' }
}
export function toggleStoryTag(
  values: Record<string, unknown>,
  group: StoryTagGroup,
  id: string,
  settings: StoriesSettings,
): Record<string, unknown> {
  const tags = group === 'main' ? settings.mainTags : settings.secondaryTags
  if (!tags.some(t => t.id === id)) throw new Error('This tag is no longer available. Reload Stories and try again.')
  const ids = storyTagIds(values, group)
  return {
    ...withStoryTagIds(values, group, ids.includes(id) ? ids.filter(v => v !== id) : [...ids, id]),
    reviewed: true,
  }
}

function keywordMatches(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text)
}
/** Approved tool behavior: whole-word/phrase suggestions from title + description. */
export function suggestStoryTags(
  values: Record<string, unknown>,
  settings: StoriesSettings,
): { main: string[]; secondary: string[] } {
  const text = [values.title, values.summary].filter(v => typeof v === 'string').join(' ')
  const matches = (tags: StoriesSettings['mainTags']) =>
    tags.filter(t => t.keywords.some(k => keywordMatches(text, k))).map(t => t.id)
  return { main: matches(settings.mainTags), secondary: matches(settings.secondaryTags) }
}
export function resuggestStoryTags(
  values: Record<string, unknown>,
  settings: StoriesSettings,
): Record<string, unknown> {
  if (values.reviewed === true) return values
  const suggested = suggestStoryTags(values, settings)
  return withStoryTagIds(withStoryTagIds(values, 'main', suggested.main), 'secondary', suggested.secondary)
}

/** A delete never retargets page filters; it only removes/moves the story tag. */
export function removeStoryTag(
  settings: StoriesSettings,
  group: StoryTagGroup,
  id: string,
  replacement: string | null,
  stories: readonly Record<string, unknown>[],
): { settings: StoriesSettings; stories: Record<string, unknown>[] } {
  const key = group === 'main' ? 'mainTags' : 'secondaryTags'
  const tags = settings[key]
  if (!tags.some(t => t.id === id)) throw new Error('This tag has already been removed. Reload Manage tags.')
  if (replacement !== null && (replacement === id || !tags.some(t => t.id === replacement)))
    throw new Error('Choose another tag in the same group.')
  const next = StoriesSettings.parse({ ...settings, [key]: tags.filter(t => t.id !== id) })
  return {
    settings: next,
    stories: stories.map(values => {
      const ids = storyTagIds(values, group)
      return ids.includes(id)
        ? withStoryTagIds(
            values,
            group,
            ids.flatMap(v => (v === id ? (replacement ? [replacement] : []) : [v])),
          )
        : values
    }),
  }
}

/** Explicit hiding/source removal also applies to manual placements and articles. */
export function storyVisible(values: Record<string, unknown>): boolean {
  return values.in_feed !== false && values.feed_removed !== true && values.hidden !== true
}

/** Shared policy for draft previews and published feed selection. */
export function storyAllowedInFeeds(values: Record<string, unknown>, settings: StoriesSettings): boolean {
  return storyVisible(values) && (settings.publishUnreviewed || values.reviewed === true)
}
/** OR within each group, AND between the two; an empty group means any. */
export function storyMatchesTags(
  values: Record<string, unknown>,
  main: readonly string[],
  secondary: readonly string[],
): boolean {
  return (
    (!main.length || main.some(id => storyTagIds(values, 'main').includes(id))) &&
    (!secondary.length || secondary.some(id => storyTagIds(values, 'secondary').includes(id)))
  )
}

const group = z.enum(['main', 'secondary'])
const id = z.string().min(1).max(80)
const tagName = z.string().trim().min(1).max(80)
const tagDetail = {
  label: tagName,
  keywords: z.array(z.string().trim().min(1).max(120)).max(50),
  areas: z.array(z.enum(STORY_MAP_AREAS)).max(6),
}
export const StoriesTagOperation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), group, ...tagDetail }).strict(),
  z.object({ action: z.literal('edit'), group, id, ...tagDetail }).strict(),
  z.object({ action: z.literal('rename-group'), group, label: tagName }).strict(),
  z.object({ action: z.literal('move'), group, id, before: id.nullable() }).strict(),
  z.object({ action: z.literal('delete'), group, id, replacement: id.nullable() }).strict(),
  z.object({ action: z.literal('resuggest') }).strict(),
  z.object({ action: z.literal('review-policy'), publishUnreviewed: z.boolean() }).strict(),
])
export type StoriesTagOperation = z.infer<typeof StoriesTagOperation>

export const StoryListPatch = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('tag'),
      group: z.enum(['main', 'secondary']),
      id: z
        .string()
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      selected: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('reviewed'), value: z.boolean() }).strict(),
  z.object({ action: z.literal('hidden'), value: z.boolean() }).strict(),
  z.object({ action: z.literal('featured'), value: z.boolean() }).strict(),
])
export type StoryListPatch = z.infer<typeof StoryListPatch>

export function applyStoryListPatch(
  values: Record<string, unknown>,
  patch: StoryListPatch,
  settings: StoriesSettings,
): Record<string, unknown> {
  if (patch.action === 'reviewed') return { ...values, reviewed: patch.value }
  if (patch.action === 'featured') return { ...values, newsroom_rank: patch.value ? storyFeatureRank(values) || 1 : 0 }
  if (patch.action === 'hidden') return { ...values, hidden: patch.value }
  const tags = patch.group === 'main' ? settings.mainTags : settings.secondaryTags
  if (!tags.some(t => t.id === patch.id))
    throw new Error('This tag is no longer available. Reload Stories and try again.')
  const ids = storyTagIds(values, patch.group)
  const next = patch.selected ? [...new Set([...ids, patch.id])] : ids.filter(id => id !== patch.id)
  return { ...withStoryTagIds(values, patch.group, next), reviewed: true }
}

/** Optional site-owned position; missing/zero stays in the date-ordered list. */
export function storyFeatureRank(values: Record<string, unknown>): number {
  return typeof values.newsroom_rank === 'number' &&
    Number.isInteger(values.newsroom_rank) &&
    values.newsroom_rank >= 1 &&
    values.newsroom_rank <= 5
    ? values.newsroom_rank
    : 0
}
export function orderedNewsroomStories<T extends { values: unknown }>(rows: readonly T[]): T[] {
  const values = (row: T) =>
    row.values && typeof row.values === 'object' ? (row.values as Record<string, unknown>) : {}
  return [...rows].sort(
    (a, b) =>
      (storyFeatureRank(values(a)) || 6) - (storyFeatureRank(values(b)) || 6) ||
      String(values(b).published_date ?? '').localeCompare(String(values(a).published_date ?? '')),
  )
}
export function newsroomSelection(selection: {
  mode: string
  filter?: unknown
  storyTags?: { main: readonly string[]; secondary: readonly string[] }
}): boolean {
  return (
    selection.mode === 'automatic' &&
    !selection.filter &&
    !selection.storyTags?.main.length &&
    !selection.storyTags?.secondary.length
  )
}

export function featureStoryRows<T extends { id: string; values: Record<string, unknown> }>(
  rows: readonly T[],
  id: string,
  featured: boolean,
): T[] {
  const target = rows.find(row => row.id === id)
  if (!target) throw new Error('This story is no longer available.')
  if (Boolean(storyFeatureRank(target.values)) === featured) return [...rows]
  const selected = orderedNewsroomStories(rows).filter(row => row.id !== id && storyFeatureRank(row.values))
  if (featured) {
    if (selected.length >= 5) throw new Error('You can feature up to 5 stories. Remove one first.')
    selected.push(target)
  }
  const positions = new Map(selected.map((row, index) => [row.id, index + 1]))
  return rows.map(row => {
    const rank = positions.get(row.id) ?? 0
    return row.id === id || storyFeatureRank(row.values)
      ? { ...row, values: { ...row.values, newsroom_rank: rank } }
      : row
  })
}
