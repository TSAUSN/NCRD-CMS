import { RESOURCE_COLLECTION_MODEL, PROGRAM_COLLECTION_MODEL } from '@cms/schema'
import type { CollectionEntryDraft, CollectionEntryValues, CollectionField, CollectionModel } from '@cms/schema'
import type { CollectionEntryWorkspace } from '../../../../lib/collection-queries.ts'

export type CollectionPresetKey = 'speakers' | 'agenda' | 'timeline' | 'faq' | 'stories' | 'resources' | 'jobs'

type Preset = { label: string; description: string; model: CollectionModel }

function model(
  fields: CollectionField[],
  presentation: Omit<CollectionModel['presentation'], 'schemaVersion'>,
): CollectionModel {
  return { fields, presentation: { schemaVersion: 1, ...presentation } }
}

export const COLLECTION_PRESETS: Record<CollectionPresetKey, Preset> = {
  speakers: {
    label: 'Speakers & people',
    description: 'Profiles, presenters, leaders and staff directories.',
    model: model(
      [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'role', label: 'Role or title', type: 'text', required: false },
        { key: 'photo', label: 'Photo', type: 'image', required: false },
        { key: 'bio', label: 'Biography', type: 'richtext', required: false },
        { key: 'profile_url', label: 'Profile link', type: 'url', required: false },
      ],
      { titleField: 'name', subtitleField: 'role', imageField: 'photo', groupField: null },
    ),
  },
  agenda: {
    label: 'Agenda',
    description: 'Scheduled sessions grouped by date or track.',
    model: structuredClone(PROGRAM_COLLECTION_MODEL),
  },
  timeline: {
    label: 'Timeline',
    description: 'Milestones, history and progress updates.',
    model: model(
      [
        { key: 'title', label: 'Milestone', type: 'text', required: true },
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'details', label: 'Details', type: 'richtext', required: false },
        { key: 'image', label: 'Image', type: 'image', required: false },
      ],
      { titleField: 'title', subtitleField: 'date', imageField: 'image', groupField: null },
    ),
  },
  faq: {
    label: 'Frequently asked questions',
    description: 'Questions and expandable answers.',
    model: model(
      [
        { key: 'question', label: 'Question', type: 'text', required: true },
        { key: 'answer', label: 'Answer', type: 'richtext', required: true },
        { key: 'topic', label: 'Topic', type: 'text', required: false },
      ],
      { titleField: 'question', subtitleField: 'topic', imageField: null, groupField: 'topic' },
    ),
  },
  stories: {
    label: 'News & stories',
    description: 'Editorial cards with article links, dates and imagery.',
    model: model(
      [
        { key: 'title', label: 'Headline', type: 'text', required: true },
        { key: 'summary', label: 'Summary', type: 'richtext', required: true },
        { key: 'image', label: 'Lead image', type: 'image', required: false },
        { key: 'published_on', label: 'Publication date', type: 'date', required: true },
        { key: 'story_url', label: 'Story link', type: 'url', required: true },
        { key: 'category', label: 'Category', type: 'text', required: false },
      ],
      { titleField: 'title', subtitleField: 'published_on', imageField: 'image', groupField: 'category' },
    ),
  },
  resources: {
    label: 'Resources',
    description: 'Downloads, guides, videos, links and related material.',
    model: structuredClone(RESOURCE_COLLECTION_MODEL),
  },
  jobs: {
    label: 'Jobs',
    description: 'Open opportunities with locations and application links.',
    model: model(
      [
        { key: 'title', label: 'Position title', type: 'text', required: true },
        { key: 'location', label: 'Location', type: 'text', required: true },
        { key: 'summary', label: 'Summary', type: 'richtext', required: false },
        { key: 'closing_date', label: 'Closing date', type: 'date', required: false },
        { key: 'apply_url', label: 'Application link', type: 'url', required: true },
      ],
      { titleField: 'title', subtitleField: 'location', imageField: null, groupField: 'location' },
    ),
  },
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

export function collectionDraftEqual(first: unknown, second: unknown): boolean {
  return canonicalJson(first) === canonicalJson(second)
}

export function collectionPublicationChanges(entries: readonly CollectionEntryWorkspace[], model: CollectionModel) {
  return entries.flatMap(entry => {
    if (entry.archived && entry.publishedValues === null) return []
    const title = String(entry.values[model.presentation.titleField] || 'Untitled item').replace(/<[^>]*>/g, '')
    const changes: string[] = []
    if (entry.archived) {
      if (!entry.publishedArchived) changes.push('Remove from the live list')
    } else if (entry.publishedValues === null) changes.push('Add to the live list')
    else {
      if (entry.publishedArchived) changes.push('Restore to the live list')
      for (const field of model.fields) {
        const before = entry.publishedValues[field.key]
        const after = entry.values[field.key]
        if (collectionDraftEqual(before, after)) continue
        if (['text', 'date', 'url', 'select', 'number', 'boolean'].includes(field.type)) {
          const text = (value: unknown) => {
            const content = value == null || value === '' ? 'Empty' : String(value)
            return content.length > 140 ? `${content.slice(0, 140)}…` : content
          }
          changes.push(`${field.label}: ${text(before)} → ${text(after)}`)
        } else changes.push(`${field.label} updated`)
      }
      if (entry.sortIndex !== entry.publishedSortIndex) changes.push(`Move to position ${entry.sortIndex + 1}`)
    }
    return changes.length ? [{ key: entry.id ?? entry.stableKey, title, changes }] : []
  })
}

export function slugifyStableKey(value: string, used: ReadonlySet<string>): string {
  const base =
    value
      .toLocaleLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || 'item'
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 70 - String(suffix).length)}-${suffix}`
    suffix += 1
  }
  return candidate
}

export function entriesFromCsv(
  rows: CollectionEntryValues[],
  titleField: string,
  existing: readonly CollectionEntryDraft[],
): CollectionEntryDraft[] {
  const used = new Set(existing.map(entry => entry.stableKey))
  return rows.map((values, index) => {
    const label = String(values[titleField] ?? `Item ${index + 1}`)
    const stableKey = slugifyStableKey(label, used)
    used.add(stableKey)
    return { id: null, stableKey, values }
  })
}

export function blankValues(fields: readonly CollectionField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field.key, field.type === 'boolean' ? false : '']))
}
