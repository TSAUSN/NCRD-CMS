/** Section anchors share the page's id namespace; editor ids stay reserved. */
export function validSectionAnchor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/.test(value) &&
    !/^s[0-9]+$/.test(value) &&
    !value.startsWith('cms-')
  )
}

/** Earlier names keep published links working while related drafts are reviewed. */
export function sectionAnchorNames(values: Record<string, unknown> | undefined): string[] {
  return [
    ...new Set(
      [
        values?.__cms_anchor,
        ...(Array.isArray(values?.__cms_anchor_aliases) ? values.__cms_anchor_aliases : []),
      ].filter(validSectionAnchor),
    ),
  ]
}
