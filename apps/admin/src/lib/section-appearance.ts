import { SectionAppearance } from '@cms/schema'
import { DomainError } from '@cms/domain'
import { sectionAppearanceSupport } from '@cms/renderer'

export async function validateAppearanceEdits(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  content: unknown,
) {
  if (!Array.isArray(content)) return
  const selected = content.filter(section => section && typeof section === 'object' && 'appearance' in section)
  if (!selected.length) return
  const keys = [...new Set(selected.map(section => `${section.section_def_id}:${section.section_def_version}`))]
  const definitions = new Map(
    (
      await client.query(
        "SELECT section_def_id::text,version::text,definition_kind,structured_doc,compiled_css AS css,slots FROM section_def_versions WHERE section_def_id::text || ':' || version::text = ANY($1::text[])",
        [keys],
      )
    ).rows.map(row => [`${row.section_def_id}:${row.version}`, row]),
  )
  for (const section of selected) {
    const parsed = SectionAppearance.safeParse(section.appearance)
    if (!parsed.success)
      throw new DomainError(
        'invalid_state',
        'Use the named section appearance choices. Custom appearance values are not supported.',
      )
    if (Object.keys(parsed.data).length === 0) continue
    if (section.raw_html?.trim() || section.custom_css?.trim())
      throw new DomainError('invalid_state', 'Reset section appearance before adding custom HTML or CSS.')
    const definition = definitions.get(`${section.section_def_id}:${section.section_def_version}`)
    const support = sectionAppearanceSupport(definition ?? {})
    if (!support.layout)
      throw new DomainError('invalid_state', support.reason ?? 'This section controls its own appearance.')
    if (parsed.data.imagePosition && !support.imagePosition)
      throw new DomainError('invalid_state', 'This section controls its picture position.')
    if (parsed.data.surface && !support.surface)
      throw new DomainError('invalid_state', support.surfaceReason ?? 'This section controls its own colours.')
  }
}
