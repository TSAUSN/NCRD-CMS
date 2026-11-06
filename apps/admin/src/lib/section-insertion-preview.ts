import { echelonSiteMedia, echelonSectionStartingValues } from './echelon-media.ts'
import { withDraftListPreview } from './draft-list-preview.ts'
import type { Queryable } from '@cms/platform'
import type { RenderManifest, SectionDefView } from '@cms/renderer'
import { markSampleValues, sectionStartingValues, type SlotDef, type StructuredDocument } from '@cms/schema'
/** Read-only page composition. No draft or sample record is created. */
export async function sectionInsertionPreview(
  client: Queryable,
  manifest: RenderManifest,
  siteId: string,
  definitionId: string,
  version: number,
  at: number,
) {
  if (
    !/^[0-9a-f-]{36}$/i.test(definitionId) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    at > manifest.sections.length
  )
    return null
  const allowed = (
    await client.query(
      `SELECT app.can_administer_site($1) AND NOT EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id IN(h.draft_version_id,h.published_version_id) WHERE h.site_id=$1 AND v.bundle ? 'original') AS allowed`,
      [siteId],
    )
  ).rows[0]?.allowed
  if (!allowed) return null
  const definition = (
    await client.query<SectionDefView & { name: string; slots: SlotDef[]; structured_doc: StructuredDocument | null }>(
      `SELECT d.id AS section_def_id,d.slug,d.name,v.version,v.compiled_ast,v.compiled_css AS css,v.slots,v.sanitizer_policy_version,v.css_policy_version,v.definition_kind,v.structured_doc,v.structured_schema_version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 AND v.version=$2 AND d.status='active' AND d.placement='page' AND (d.scope='global' OR d.site_id=$3)`,
      [definitionId, version, siteId],
    )
  ).rows[0]
  if (!definition) return null
  const initial = markSampleValues(sectionStartingValues(definition.slots)),
    media = JSON.stringify(initial).includes('/cms-samples/') ? await echelonSiteMedia(client, siteId) : null
  const sections = [...manifest.sections]
  sections.splice(at, 0, {
    def: definition,
    instance: {
      section_def_id: definitionId,
      section_def_version: version,
      label: definition.name,
      values: media ? echelonSectionStartingValues(definition.slots, media, definition.slug ?? '') : initial,
      hidden: false,
      hidden_at: [],
    },
  })
  const source = (
    await client.query<{ content: { values?: Record<string, unknown> }[] }>(
      'SELECT content FROM page_versions WHERE id=$1 AND site_id=$2',
      [manifest.page.version_id, siteId],
    )
  ).rows[0]
  if (!source) return null
  const content = [...source.content]
  content.splice(at, 0, sections[at]!.instance)
  return withDraftListPreview(client, { ...manifest, sections }, manifest.page.version_id, siteId, content)
}
