type Section = { label?: string; values?: Record<string, unknown> }
type Layout =
  | { name: string; slug?: string; slots: readonly { id: string; kind: string; label: string }[] }
  | null
  | undefined
const plain = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
// Source reports use capitals for page typography; editor navigation uses readable names.
function readable(words: string) {
  if (words !== words.toUpperCase() || !/[A-Z]/.test(words)) return words
  const small = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])
  const acronyms = new Set(['SAWSO', 'USA', 'UK', 'UN', 'UNICEF', 'HIV', 'AIDS', 'FAQ'])
  return words
    .split(' ')
    .map((word, index) =>
      acronyms.has(word)
        ? word
        : index > 0 && small.has(word.toLowerCase())
          ? word.toLowerCase()
          : word
              .toLowerCase()
              .replace(/(^|[-–—:])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase()),
    )
    .join(' ')
}
const same = (left: string, right: string) => left.toLocaleLowerCase() === right.toLocaleLowerCase()
/** Personal names win; default names describe this section's own content. */
export function sectionDisplayName(section: Section, layout: Layout): string {
  const label = section.label?.trim()
  const type = layout?.name ?? 'Section'
  if (
    layout?.slug === 'core-feature-slider' &&
    (!label || ['Featured stories', 'Feature slider', 'Hero slider'].includes(label))
  )
    return 'Hero slider'
  if (label && !same(label, type) && !(layout?.slug === 'core-report-country-story' && same(label, 'Country story')))
    return label
  if (layout?.slug === 'core-report-country-story') {
    const words = plain(section.values?.country) || plain(section.values?.title) || plain(section.values?.heading)
    return words
      ? section.values?.__cms_report_part === 'fact'
        ? readable(words)
        : 'Country story — ' + readable(words)
      : 'Country story'
  }
  const words = layout?.slots
    .filter(slot => slot.kind === 'text' && /heading|headline|title/i.test(slot.id + ' ' + slot.label))
    .map(slot => plain(section.values?.[slot.id]))
    .find(Boolean)
  return words && !same(words, type) ? type + ' — ' + readable(words) : type
}
