import { SectionAppearance } from '@cms/schema'
import { DomainError } from '@cms/domain'
import { sectionAppearanceSupport } from '@cms/renderer'
import { UUID_SHAPE } from '../server/queries/record-id.ts'

export async function validateAppearanceEdits(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  content: unknown,
) {
  if (!Array.isArray(content)) return
  const choices: { key: string; appearance: SectionAppearance }[] = []
  const pins = new Map<string, { id: string; version: number }>()
  for (const section of content) {
    if (!section || typeof section !== 'object' || !('appearance' in section)) continue
    const parsed = SectionAppearance.safeParse(section.appearance)
    if (!parsed.success)
      throw new DomainError(
        'invalid_state',
        'Use the named section appearance choices. Custom appearance values are not supported.',
      )
    if (!Object.keys(parsed.data).length) continue
    if (section.raw_html?.trim() || section.custom_css?.trim())
      throw new DomainError('invalid_state', 'Reset section appearance before adding custom HTML or CSS.')
    const { section_def_id: id, section_def_version: pin } = section
    const version = typeof pin === 'number' || typeof pin === 'string' ? Number(pin) : NaN
    if (
      typeof id !== 'string' ||
      !UUID_SHAPE.test(id) ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > 2147483647 ||
      String(version) !== String(pin)
    )
      throw new DomainError('invalid_state', 'Choose an existing section before changing its appearance.')
    const key = `${id.toLowerCase()}:${version}`
    pins.set(key, { id, version })
    choices.push({ key, appearance: parsed.data })
  }
  if (!choices.length) return

  // Match exact pins through the existing (section_def_id, version) index.
  const refs = [...pins.values()]
  const definitions = new Map(
    (
      await client.query(
        `SELECT section_def_id::text,version::text,definition_kind,structured_doc,compiled_css AS css,slots
         FROM unnest($1::uuid[],$2::int[]) AS pin(def_id,def_version)
         JOIN section_def_versions ON section_def_id=pin.def_id AND version=pin.def_version`,
        [refs.map(ref => ref.id), refs.map(ref => ref.version)],
      )
    ).rows.map(row => [`${row.section_def_id}:${row.version}`, row]),
  )
  for (const { key, appearance } of choices) {
    const support = sectionAppearanceSupport(definitions.get(key) ?? {})
    if (!support.layout)
      throw new DomainError('invalid_state', support.reason ?? 'This section controls its own appearance.')
    if (appearance.imagePosition && !support.imagePosition)
      throw new DomainError('invalid_state', 'This section controls its picture position.')
    if (appearance.surface && !support.surface)
      throw new DomainError('invalid_state', support.surfaceReason ?? 'This section controls its own colours.')
  }
}
