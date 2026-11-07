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
type ReadinessTarget = { pageId: string; versionId: string; findings: ReadinessFinding[] }
const fieldRules = new Set(['sample_content', 'image_without_alt', 'broken_internal_link', 'missing_h1'])
const targetKey = (target: Pick<ReadinessTarget, 'pageId' | 'versionId'>) => target.pageId + ':' + target.versionId

/** Load only the pinned page versions needed to give a finding a field link. */
export async function releaseReadinessFixLinks(
  client: Queryable,
  siteId: string,
  targets: ReadinessTarget[],
): Promise<string[][]> {
  const fieldTargets = targets.filter(target => target.findings.some(finding => fieldRules.has(finding.rule)))
  const byTarget = new Map<string, Section[]>()
  const sampleSectionIds = new Set<string>()
  if (fieldTargets.length) {
    const { rows } = await client.query<{ page_id: string; id: string; content: Section[] }>(
      `SELECT v.id,v.page_id,v.content FROM unnest($1::uuid[],$2::uuid[]) AS pin(version_id,page_id)
       CROSS JOIN LATERAL (
         SELECT id,page_id,content FROM page_versions
         WHERE id=pin.version_id AND page_id=pin.page_id LIMIT 1
       ) v`,
      [fieldTargets.map(target => target.versionId), fieldTargets.map(target => target.pageId)],
    )
    for (const row of rows) byTarget.set(targetKey({ pageId: row.page_id, versionId: row.id }), row.content)
    for (const target of fieldTargets)
      if (target.findings.some(finding => finding.rule === 'sample_content'))
        for (const section of byTarget.get(targetKey(target)) ?? []) sampleSectionIds.add(section.section_def_id)
  }
  const names = sampleSectionIds.size
    ? Object.fromEntries(
        (
          await client.query<{ id: string; name: string }>(
            'SELECT id,name FROM section_defs WHERE id=ANY($1::uuid[])',
            [[...sampleSectionIds]],
          )
        ).rows.map(row => [row.id, row.name]),
      )
    : {}
  return targets.map(target => fixLinks(target, siteId, byTarget.get(targetKey(target)) ?? [], names))
}

function fixLinks(
  { pageId, findings }: ReadinessTarget,
  siteId: string,
  sections: Section[],
  names: Record<string, string>,
): string[] {
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
