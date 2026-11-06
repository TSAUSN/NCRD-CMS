/** Plain names for inferred V1 identifiers; authored labels still take precedence.
 * Keep identifiers and field paths stable: changing a label is presentation only. */
export function inferredFieldLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\bamp\b/gi, 'and')
    .replace(/\bfaq\b/gi, 'FAQ')
    .replace(/\bcta primary\b/gi, 'primary button')
    .replace(/\bcta secondary\b/gi, 'secondary button')
    .replace(/\bcta\b/gi, 'button')
    .replace(/\b(timeline|map) rail\b/gi, '$1 items')
    .replace(/\brichcols cols\b/gi, 'Text columns')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, character => character.toUpperCase())
}
