import type { ReadinessFinding } from '@cms/domain'
import type { Queryable } from '@cms/platform'
type Section = { values: Record<string, unknown>; label?: string; section_def_id: string; section_def_version: number }
function contains(value: unknown, wanted: string): boolean {
  if (typeof value === 'string')
    return value === wanted || value.includes(`"${wanted}"`) || value.includes(`href="${wanted}"`)
  if (Array.isArray(value)) return value.some(child => contains(child, wanted))
  return !!value && typeof value === 'object' && Object.values(value).some(child => contains(child, wanted))
}
function missingPictureDescription(value: unknown, source: string | null): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(child => missingPictureDescription(child, source))
  const object = value as Record<string, unknown>
  if (
    typeof object.src === 'string' &&
    (!source || object.src === source) &&
    object.decorative !== true &&
    !(typeof object.alt === 'string' && object.alt.trim())
  )
    return true
  return Object.values(object).some(child => missingPictureDescription(child, source))
}
/** Resolve only fields in the pinned page; no source HTML is exposed to the UI. */
export async function readinessFixLinks(
  client: Queryable,
  pageId: string,
  versionId: string,
  siteId: string,
  findings: ReadinessFinding[],
): Promise<string[]> {
  const row = (
    await client.query<{ content: Section[] }>('SELECT content FROM page_versions WHERE id=$1 AND page_id=$2', [
      versionId,
      pageId,
    ])
  ).rows[0]
  const sections = row?.content ?? []
  const names = Object.fromEntries(
    (
      await client.query<{ id: string; name: string }>(`SELECT id,name FROM section_defs WHERE id=ANY($1::uuid[])`, [
        sections.map(section => section.section_def_id),
      ])
    ).rows.map(row => [row.id, row.name]),
  )
  const base = `/pages/${pageId}`
  return findings.map(finding => {
    if (['missing_title', 'missing_meta_description', 'refused_canonical'].includes(finding.rule))
      return `${base}?settings=1&focus=${finding.rule === 'missing_title' ? 'title' : finding.rule === 'missing_meta_description' ? 'description' : 'canonical'}`
    for (const [index, section] of sections.entries()) {
      const values = section.values
      const field = Object.keys(values).find(key =>
        finding.rule === 'sample_content'
          ? Array.isArray(values.__cms_sample_fields) &&
            values.__cms_sample_fields.includes(key) &&
            finding.message.startsWith(
              (section.label || names[section.section_def_id] || '') + ' still contains sample content',
            )
          : finding.rule === 'image_without_alt'
            ? missingPictureDescription(values[key], /\bsrc="([^"]*)"/.exec(finding.detail ?? '')?.[1] ?? null)
            : finding.rule === 'broken_internal_link'
              ? contains(values[key], finding.detail ?? '')
              : finding.rule === 'missing_h1'
                ? /heading|title/i.test(key)
                : false,
      )
      if (field)
        return `${base}?section=${index}&field=${encodeURIComponent(field)}${finding.rule === 'image_without_alt' ? '&focus=picture-description' : ''}`
    }
    // Shared frame/menu links are fixed in their real site-wide context.
    if (finding.rule === 'broken_internal_link' || finding.rule === 'image_without_alt')
      return `/sites/${siteId}/design`
    return base
  })
}
