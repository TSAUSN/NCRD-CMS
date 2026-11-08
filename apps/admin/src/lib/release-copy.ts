import { storyFeatureRank } from '@cms/schema'
import { repeatItemSpec, repeatItemKeys, repeatItemSlotId, type FieldLike } from '@cms/schema'
import type { ReleaseItem } from './releases.ts'
export type ChangeCell = { label: string; before: string; after: string }
export type ReleasePresentation = {
  summary: string
  noVisibleChanges?: boolean
  changes?: { text: string; sectionIndex?: number }[]
  beforeVersionId?: string
  preview?: { live: string | null; saved: string; note: string }
  cells: ChangeCell[]
}
export const releaseGroup = (item: ReleaseItem): 'Pages' | 'Lists' | 'Site look' | 'Data values' =>
  item.type === 'site_settings' && item.label === 'Data values'
    ? 'Data values'
    : item.type === 'page' || item.type === 'chapter_setup'
      ? 'Pages'
      : item.type.startsWith('collection_')
        ? 'Lists'
        : 'Site look'
export function releaseLabel(item: Pick<ReleaseItem, 'type' | 'label' | 'entryIds'>): string {
  if (item.type === 'collection_schema') return item.label.replace(/ schema$/, '') + ' · fields'
  if (item.type === 'collection_entries' && item.entryIds) return item.label
  if (item.type === 'collection_entries') return item.label.replace(/ records$/, '') + ' · items'
  if (item.type === 'theme') return 'Colours, fonts and buttons'
  if (item.type === 'navigation') return 'Menu'
  return item.label
}
export function readableReleaseValue(value: unknown): string {
  if (value == null || value === '') return 'Empty'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value.replace(/<[^>]*>/g, '').trim() || 'Empty'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(readableReleaseValue).join(' · ') || 'Empty'
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    if ('mediaId' in object || 'assetId' in object || 'media_id' in object)
      return 'Picture selected' + (typeof object.alt === 'string' ? ` · ${object.alt}` : '')
    return (
      Object.entries(object)
        .filter(([key]) => !key.startsWith('__cms') && !/^(id|page_id|readerKey)$/.test(key))
        .map(([, value]) => readableReleaseValue(value))
        .join(' · ') || 'Empty'
    )
  }
  return 'Empty'
}
/** Labels come from the saved form; internal field identifiers stay private. */
export function changedCells(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): ChangeCell[] {
  return Object.entries(labels).flatMap(([key, label]) =>
    JSON.stringify(before[key]) === JSON.stringify(after[key])
      ? []
      : [{ label, before: readableReleaseValue(before[key]), after: readableReleaseValue(after[key]) }],
  )
}

type ReviewSection = {
  section_def_id: string
  section_def_version?: number
  values: Record<string, unknown>
  label?: string
  hidden?: boolean
  hidden_at?: string[]
  appearance?: unknown
  custom_css?: string
  raw_html?: string
}
type ReviewForm = { name: string; slots: FieldLike[] }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
function pictureChange(before: unknown, after: unknown) {
  const a = object(before)
  const b = object(after)
  if (a.src === b.src && a.media_id === b.media_id && a.mediaId === b.mediaId) {
    if (a.alt === b.alt && !same(a.focal ?? a.focus, b.focal ?? b.focus)) return 'changed the focus point'
    if (a.alt !== b.alt) return 'changed the photo description'
  }
  return 'changed the photo'
}
function oneParagraphChanged(a: unknown, b: unknown) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const pattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi
  const was = a.match(pattern) ?? []
  const now = b.match(pattern) ?? []
  return (
    was.length === now.length &&
    was.filter((paragraph, index) => paragraph !== now[index]).length === 1 &&
    a.replace(pattern, '[paragraph]') === b.replace(pattern, '[paragraph]')
  )
}
function fieldValue(value: unknown, kind: string): string {
  if (kind === 'icon') return typeof value === 'string' && value ? value.replace(/_/g, ' ') : 'Empty'
  if (kind === 'image') {
    const image = object(value)
    return typeof image.alt === 'string' && image.alt ? image.alt : value ? 'Photo selected' : 'No photo'
  }
  if (kind === 'link') {
    const link = object(value)
    return typeof value === 'string'
      ? value
      : typeof link.url === 'string'
        ? link.url
        : typeof link.href === 'string'
          ? link.href
          : value
            ? 'Destination selected'
            : 'No destination'
  }
  if (kind === 'button') {
    const button = object(value)
    return (
      [button.label ?? button.text, button.url ?? button.href].filter(v => typeof v === 'string' && v).join(' · ') ||
      'Button settings'
    )
  }
  return readableReleaseValue(value)
}
/** One saved-difference vocabulary for the writer and the Publish Ready list. */
export function pageContentChanges(
  before: ReviewSection[],
  after: ReviewSection[],
  forms: Record<string, ReviewForm>,
): { summary: string[]; cells: ChangeCell[] } {
  const used = new Set<number>()
  const cells: ChangeCell[] = []
  const summary: string[] = []
  const order: number[] = []
  const nameOf = (section: ReviewSection) =>
    section.label || forms[`${section.section_def_id}:${section.section_def_version ?? 1}`]?.name || 'Section'
  for (const section of after) {
    let previous = before.findIndex((old, at) => !used.has(at) && same(old, section))
    if (previous < 0)
      previous = before.findIndex(
        (old, at) => !used.has(at) && old.section_def_id === section.section_def_id && old.label === section.label,
      )
    if (previous < 0)
      previous = before.findIndex((old, at) => !used.has(at) && old.section_def_id === section.section_def_id)
    const form = forms[`${section.section_def_id}:${section.section_def_version ?? 1}`]
    const name = nameOf(section)
    const say = (words: string) => summary.push(name + ': ' + words)
    if (previous < 0) {
      say('added this section')
      cells.push({ label: name, before: 'Not on this page', after: 'Added to this page' })
      continue
    }
    used.add(previous)
    order.push(previous)
    const old = before[previous]!
    const known = new Set<string>()
    if (old.values.__cms_anchor !== section.values.__cms_anchor) {
      const next = String(section.values.__cms_anchor ?? '')
      say(
        next
          ? (old.values.__cms_anchor ? 'changed the section link name to ' : 'added the section link ') + next
          : 'removed the section link',
      )
      cells.push({
        label: name + ' · Link to this section',
        before: old.values.__cms_anchor ? '#' + String(old.values.__cms_anchor) : 'No section link',
        after: next ? '#' + next : 'No section link',
      })
    }
    for (const slot of form?.slots ?? []) {
      known.add(slot.id)
      const repeat = repeatItemSpec(slot)
      if (repeat) {
        const was = repeatItemKeys(old.values[slot.id])
        const now = repeatItemKeys(section.values[slot.id])
        const unit = repeat.unit.toLowerCase()
        const titleField = repeat.fields.find(field => field.kind === 'text' && /title|heading|name/i.test(field.id))
        const title = (values: Record<string, unknown>, key: string) =>
          titleField ? readableReleaseValue(values[repeatItemSlotId(slot.id, key, titleField.id)]) : ''
        const itemName = (values: Record<string, unknown>, key: string) => {
          const words = title(values, key)
          return unit + (words && words !== 'Empty' ? ', "' + words + '"' : '')
        }
        for (const key of now.filter(key => !was.includes(key))) {
          say('added ' + (/^[aeiou]/.test(unit) ? 'an ' : 'a ') + itemName(section.values, key))
          for (const field of repeat.fields) {
            const value = fieldValue(section.values[repeatItemSlotId(slot.id, key, field.id)], field.kind)
            if (value !== 'Empty' && value !== 'No photo' && value !== 'No destination')
              cells.push({
                label: name + ' · ' + itemName(section.values, key) + ' · ' + field.label,
                before: 'Not on this page',
                after: value,
              })
          }
        }
        for (const key of was.filter(key => !now.includes(key))) {
          say('removed ' + itemName(old.values, key))
          for (const field of repeat.fields) {
            const value = fieldValue(old.values[repeatItemSlotId(slot.id, key, field.id)], field.kind)
            if (value !== 'Empty' && value !== 'No photo' && value !== 'No destination')
              cells.push({
                label: name + ' · ' + itemName(old.values, key) + ' · ' + field.label,
                before: value,
                after: 'Removed from this page',
              })
          }
        }
        const common = now.filter(key => was.includes(key))
        if (
          !same(
            was.filter(key => now.includes(key)),
            common,
          )
        )
          say('reordered ' + unit + 's')
        for (const key of new Set([...was, ...now]))
          for (const field of repeat.fields) known.add(repeatItemSlotId(slot.id, key, field.id))
        for (const key of common) {
          let edited = false
          for (const field of repeat.fields) {
            const id = repeatItemSlotId(slot.id, key, field.id)
            const a = old.values[id]
            const b = section.values[id]
            if (same(a, b)) continue
            const label = unit === 'slide' ? 'slide ' + (now.indexOf(key) + 1) : itemName(section.values, key)
            if (field.kind === 'image') say(pictureChange(a, b) + ' on ' + label)
            else edited = true
            cells.push({
              label: name + ' · ' + label + ' · ' + field.label,
              before: fieldValue(a, field.kind),
              after: fieldValue(b, field.kind),
            })
          }
          if (edited) say('edited ' + itemName(section.values, key))
        }
        continue
      }
      const a = old.values[slot.id]
      const b = section.values[slot.id]
      if (same(a, b)) continue
      if (slot.kind === 'repeat') {
        say('changed which stories or items show')
        cells.push({ label: name + ' · ' + slot.label, before: 'Earlier selection', after: 'Updated selection' })
        continue
      }
      if (slot.kind === 'image') say(pictureChange(a, b))
      else if (slot.kind === 'richtext' && oneParagraphChanged(a, b)) say('edited 1 paragraph')
      else say('changed ' + slot.label.toLowerCase())
      cells.push({
        label: name + ' · ' + slot.label,
        before: fieldValue(a, slot.kind),
        after: fieldValue(b, slot.kind),
      })
    }
    if (!same(old.hidden ?? false, section.hidden ?? false) || !same(old.hidden_at ?? [], section.hidden_at ?? [])) {
      const visibility = (part: ReviewSection) =>
        part.hidden
          ? 'Hidden'
          : part.hidden_at?.length
            ? 'Hidden on ' +
              part.hidden_at
                .map(v => (v === 'mobile' ? 'Phone' : v === 'tablet' ? 'Tablet' : v === 'desktop' ? 'Desktop' : v))
                .join(', ')
            : 'Shown on every device'
      say('changed where this section is shown')
      cells.push({ label: name + ' · Visibility', before: visibility(old), after: visibility(section) })
    }
    if ((old.section_def_version ?? 1) !== (section.section_def_version ?? 1)) {
      say('updated the layout')
      cells.push({ label: name + ' · Layout', before: 'Earlier layout', after: 'Updated layout' })
    }
    if (!same(old.appearance, section.appearance) || old.custom_css !== section.custom_css) {
      say('changed the appearance')
      cells.push({ label: name + ' · Appearance', before: 'Earlier appearance', after: 'Updated appearance' })
    }
    if (old.raw_html !== section.raw_html) {
      say('updated custom content')
      cells.push({
        label: name + ' · Custom content',
        before: 'Earlier custom content',
        after: 'Updated custom content',
      })
    }
    if (old.label !== section.label) {
      say('changed the section name')
      cells.push({ label: 'Section name', before: nameOf(old), after: name })
    }
    if (
      Object.keys({ ...old.values, ...section.values }).some(
        key => !known.has(key) && !key.startsWith('__cms') && !same(old.values[key], section.values[key]),
      )
    )
      say('updated other content')
  }
  for (const [at, section] of before.entries())
    if (!used.has(at)) {
      summary.push(nameOf(section) + ': removed this section')
      cells.push({ label: nameOf(section), before: 'On this page', after: 'Removed from this page' })
    }
  if (order.some((at, index) => index > 0 && at < order[index - 1]!)) summary.push('Sections rearranged')
  return { summary: [...new Set(summary)], cells }
}

export function pageChangePresentation(
  before: ReviewSection[] | null,
  after: ReviewSection[],
  forms: Record<string, ReviewForm>,
  oldDetails: Record<string, unknown> | null,
  details: Record<string, unknown>,
): ReleasePresentation {
  const diff = pageContentChanges(before ?? [], after, forms)
  const metadata = changedCells(oldDetails ?? {}, details, {
    title: 'Page name',
    address: 'Address',
    description: 'Search description',
  })
  const words = [
    ...(!before ? ['New page'] : []),
    ...diff.summary,
    ...metadata.map(cell => cell.label + ': ' + (!before ? 'added' : 'changed')),
  ]
  const changes = words.map(text => {
    const sectionIndex = after.findIndex(section =>
      text.startsWith(
        (section.label || forms[`${section.section_def_id}:${section.section_def_version ?? 1}`]?.name || 'Section') +
          ': ',
      ),
    )
    return { text, ...(sectionIndex >= 0 ? { sectionIndex } : {}) }
  })
  return { summary: words.join(' · ') || 'No page changes', changes, cells: [...diff.cells, ...metadata] }
}

/** Content words for an individual Story review; never expose image IDs or tag keys. */
export function storyEntryPresentation(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: readonly { key: string; label: string; type: string }[],
  names: { main: Record<string, string>; secondary: Record<string, string> },
): ReleasePresentation {
  const title = String(after.title ?? 'Story')
  const cells: ChangeCell[] = []
  const tags = (value: unknown, choices: Record<string, string>) =>
    typeof value === 'string'
      ? value
          .split(',')
          .filter(Boolean)
          .map(id => choices[id] ?? 'Unavailable tag')
          .join(', ')
      : ''
  for (const field of fields) {
    const a = before?.[field.key] ?? (field.type === 'boolean' ? false : '')
    const b = after[field.key] ?? (field.type === 'boolean' ? false : '')
    if (field.key === 'newsroom_rank' && storyFeatureRank(before ?? {}) === storyFeatureRank(after)) continue
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    let label = field.label
    let oldValue: unknown = a
    let newValue: unknown = b
    if (field.key === 'newsroom_rank') {
      label = 'Newsroom order'
      oldValue = storyFeatureRank(before ?? {}) ? 'Featured position ' + storyFeatureRank(before ?? {}) : 'Not featured'
      newValue = storyFeatureRank(after) ? 'Featured position ' + storyFeatureRank(after) : 'Not featured'
    }
    if (['tags', 'regions', 'region'].includes(field.key)) {
      const choices = field.key === 'tags' ? names.main : names.secondary
      oldValue = tags(a, choices)
      newValue = tags(b, choices)
    }
    if (field.key === 'sector_links') label = fields.find(f => f.key === 'tags')?.label ?? 'Main tags'
    if (field.key === 'region_label')
      label = fields.find(f => f.key === 'regions' || f.key === 'region')?.label ?? 'Secondary tags'
    if (field.type === 'image') {
      const oldPhoto = a && typeof a === 'object' ? (a as Record<string, unknown>) : null
      const next = b && typeof b === 'object' ? (b as Record<string, unknown>) : null
      if (oldPhoto && next && oldPhoto.src === next.src && oldPhoto.alt === next.alt) {
        label = 'Photo focus'
        oldValue = 'Earlier focus point'
        newValue = 'New focus point'
      } else {
        oldValue = oldPhoto?.alt || 'No photo'
        newValue = next?.alt || 'No photo'
      }
    }
    cells.push({ label, before: readableReleaseValue(oldValue), after: readableReleaseValue(newValue) })
  }
  const changed = [...new Set(cells.map(c => c.label))]
  const words =
    changed
      .slice(0, 4)
      .map(name => name + ' changed')
      .join(', ') + (changed.length > 4 ? `, and ${changed.length - 4} more changes` : '')
  const rank = storyFeatureRank(after)
  const oldRank = storyFeatureRank(before ?? {})
  const onlyOrder = before && changed.length === 1 && changed[0] === 'Newsroom order'
  return {
    summary: onlyOrder
      ? `${title}: ${!rank ? 'removed from featured stories' : !oldRank ? 'featured in the Newsroom' : 'moved to position ' + rank + ' in the Newsroom'}`
      : before
        ? `${title}: ${words || 'Saved story details'}`
        : `Added story: ${title}`,
    cells: cells.map(cell => ({ ...cell, label: title + ' · ' + cell.label })),
  }
}
