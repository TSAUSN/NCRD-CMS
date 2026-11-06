import { deepEqual } from '@cms/domain'

export type ComparisonVersion = {
  page_title: string
  page_slug: string
  content: unknown
  meta: Record<string, unknown>
}

export type VersionChange = { label: string; before: unknown; after: unknown }

/** Sections have no persistent instance IDs. Compare positions explicitly;
 * never imply that two identical section types can be matched across moves. */
export function compareVersions(before: ComparisonVersion, after: ComparisonVersion): VersionChange[] {
  const changes: VersionChange[] = []
  const add = (label: string, left: unknown, right: unknown) => {
    if (!deepEqual(left, right)) changes.push({ label, before: left, after: right })
  }
  add('Page name', before.page_title, after.page_title)
  add('Web address', `/${before.page_slug}`, `/${after.page_slug}`)
  for (const key of keys(before.meta, after.meta)) {
    add(`Page details · ${key}`, before.meta[key], after.meta[key])
  }
  const left = Array.isArray(before.content) ? before.content : []
  const right = Array.isArray(after.content) ? after.content : []
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] as Record<string, unknown> | undefined
    const b = right[index] as Record<string, unknown> | undefined
    const label = `Position ${index + 1}`
    if (!a || !b || a['section_def_id'] !== b['section_def_id']) {
      add(`${label} · section`, a, b)
      continue
    }
    for (const key of keys(a, b).filter(key => key !== 'values')) {
      const names: Record<string, string> = {
        section_def_version: 'section version',
        hidden: 'hidden',
        hidden_at: 'hidden at screen sizes',
        label: 'label',
        custom_css: 'custom styling',
        raw_html: 'custom content',
      }
      add(`${label} · ${names[key] ?? key}`, a[key], b[key])
    }
    const aValues = (a['values'] ?? {}) as Record<string, unknown>
    const bValues = (b['values'] ?? {}) as Record<string, unknown>
    for (const key of keys(aValues, bValues)) add(`${label} · ${key}`, aValues[key], bValues[key])
  }
  return changes
}

function keys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
}

export function comparisonText(value: unknown): string {
  if (value === undefined) return 'Not present'
  if (value === null) return 'None'
  if (typeof value === 'string') return value || '(empty)'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return JSON.stringify(value, null, 2)
}
