import { STRUCTURED_SCHEMA_VERSION, type StructuredFieldDef, type StructuredNode } from '@cms/schema'
import { SANITIZER_POLICY_VERSION } from '../compile.ts'
import { CSS_POLICY_VERSION } from '../css.ts'
import { renderSection, type ManifestSection, type SectionDefView } from '../render.ts'
import { MALICIOUS_CASES } from './malicious.ts'

/** The empty compiled template every structured row stores (migration 0019). */
const NO_TEMPLATE = { nodes: [], policyVersion: SANITIZER_POLICY_VERSION, cssPolicyVersion: CSS_POLICY_VERSION }

export function structuredDef(
  fields: StructuredFieldDef[],
  nodes: StructuredNode[],
  overrides: Partial<SectionDefView> = {},
): SectionDefView {
  return {
    section_def_id: 'd',
    version: 1,
    slug: 'structured',
    compiled_ast: NO_TEMPLATE,
    definition_kind: 'structured',
    structured_doc: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields, nodes },
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    ...overrides,
  }
}

/** One field of one type, inside a section element. */
export function oneField(
  type: Exclude<StructuredFieldDef['type'], 'repeat'>,
  overrides: Partial<SectionDefView> = {},
): SectionDefView {
  return structuredDef(
    [{ name: 'value', type, label: 'Value' }],
    [{ type: 'element', tag: 'section', children: [{ type: type, field: 'value' }] }],
    overrides,
  )
}

export function render(def: SectionDefView, values: Record<string, unknown>, preview = false): string {
  const section = { def, instance: { section_def_id: 'd', section_def_version: 1, values } } as ManifestSection
  return renderSection(section, 0, preview ? { preview: true } : {})
}

const label = (c: (typeof MALICIOUS_CASES)[number]) => `${c.id} (${c.intent})`
export const cases = MALICIOUS_CASES.map(c => [label(c), c] as const)
