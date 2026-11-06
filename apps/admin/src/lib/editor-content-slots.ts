/** Keep the structure rail and inspector on the same native content controls. */
export function editorContentSlots<T extends { id: string; label: string; constraints?: Record<string, unknown> }>(
  slots: readonly T[],
  slug: string | undefined,
  native: boolean,
  values: Record<string, unknown> = {},
): T[] {
  const report =
    native &&
    (values.__cms_report_template === 'annual' ||
      values.__cms_report_links === true ||
      slug?.startsWith('core-report-'))
  let result = slots
    .filter(slot => !slot.constraints?.reportOnly || report)
    .map(slot => {
      const item = slot.constraints?.item
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        !Array.isArray((item as { fields?: unknown }).fields)
      )
        return slot
      return {
        ...slot,
        constraints: {
          ...slot.constraints,
          item: {
            ...item,
            fields: (item as { fields: { id: string; constraints?: Record<string, unknown> }[] }).fields.filter(
              field =>
                (!field.constraints?.reportOnly || report) &&
                !(values.__cms_report_part === 'metrics' && field.id === 'context') &&
                !(values.__cms_report_part === 'vision' && field.id === 'icon'),
            ),
          },
        },
      }
    }) as T[]
  const part = report ? values.__cms_report_part : null
  const only: Record<string, string[]> = {
    cover: ['heading', 'subheading', 'kicker', 'photo', 'primary', 'secondary', 'caption'],
    vision: ['cards'],
    metrics: ['intro', 'photo', 'photo_note', 'stats', 'source'],
    closing: ['heading', 'photo'],
  }
  if (typeof part === 'string' && only[part]) result = result.filter(slot => only[part]!.includes(slot.id))
  if (part === 'mission')
    result = result.map(slot =>
      slot.id === 'report_page'
        ? { ...slot, label: 'Main button' }
        : slot.id === 'report_pdf'
          ? { ...slot, label: 'Second button' }
          : slot,
    )
  if (report && slug === 'core-text-image' && part !== 'mission' && values.__cms_report_links !== true)
    result = result.filter(slot => !['report_page', 'report_pdf'].includes(slot.id))
  if (native && values.__cms_report_links === true)
    return result
      .filter(slot => ['heading', 'report_page', 'report_pdf'].includes(slot.id))
      .map(slot =>
        slot.id === 'heading'
          ? slot
          : {
              ...slot,
              constraints: {
                ...slot.constraints,
                destinationOnly: true,
                reportLink: slot.id === 'report_pdf' ? 'pdf' : 'page',
                fixedLabel: slot.id === 'report_pdf' ? 'View PDF' : 'View page',
              },
            },
      ) as T[]
  if (native && slug === 'core-report-page-links') return result.filter(slot => slot.id !== 'links')
  if (native && slug === 'core-report-country-story') return result.filter(slot => slot.id !== 'layout')
  if (native && slug === 'core-feature-slider')
    return result.filter(slot => !['auto_change', 'seconds'].includes(slot.id))
  if (!native || slug !== 'core-stories') return result
  return result
    .filter(slot => slot.id !== 'more')
    .map(slot => (slot.id === 'newsroom' ? { ...slot, label: 'Archive link (optional)' } : slot))
}
