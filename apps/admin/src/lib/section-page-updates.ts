import 'server-only'
import { DomainError, type EditorSection } from '@cms/domain'
import type { Queryable } from '@cms/platform'
import { loadSectionUpgrade, renderUpgradeSet, type UpgradeRequest } from './section-upgrade-service.ts'
export type SectionPagePin = { pageId: string; sourceVersionId: string; revision: number }
export type SectionUpdatePage = SectionPagePin & { title: string; siteName: string; placements: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function sectionUpdateAccess(client: Queryable, siteId: string, definitionId: string, targetVersion: number) {
  if (!uuid.test(siteId) || !uuid.test(definitionId) || !Number.isSafeInteger(targetVersion) || targetVersion < 1)
    throw new DomainError('invalid_state', 'Choose a section from this site’s library.')
  const row = (
    await client.query<{ name: string }>(
      `SELECT d.name FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id JOIN sites s ON s.id=$1
 WHERE d.id=$2 AND d.status='active' AND d.placement='page' AND (d.scope='global' OR d.site_id=$1) AND v.version=$3
 AND s.status<>'archived' AND app.can_administer_site(s.id)`,
      [siteId, definitionId, targetVersion],
    )
  ).rows[0]
  if (!row) throw new DomainError('not_found', 'Only a site administrator can review these page updates.')
  return row
}
export async function listSectionUpdatePages(
  client: Queryable,
  siteId: string,
  definitionId: string,
  targetVersion: number,
) {
  await sectionUpdateAccess(client, siteId, definitionId, targetVersion)
  return (
    await client.query<SectionUpdatePage>(
      `SELECT p.id AS "pageId",p.draft_version_id AS "sourceVersionId",p.revision::int AS revision,p.title,s.name AS "siteName",count(*)::int AS placements
 FROM pages p JOIN sites s ON s.id=p.site_id JOIN page_versions v ON v.id=p.draft_version_id
 CROSS JOIN LATERAL jsonb_array_elements(v.content) section
 WHERE p.archived_at IS NULL AND s.status<>'archived' AND app.can_administer_site(s.id)
 AND section->>'section_def_id'=$1 AND (section->>'section_def_version')::int<$2
 GROUP BY p.id,s.id ORDER BY s.name,p.title,p.id`,
      [definitionId, targetVersion],
    )
  ).rows
}
async function checkedInputs(client: Queryable, definitionId: string, targetVersion: number, pin: SectionPagePin) {
  if (!uuid.test(pin.pageId) || !uuid.test(pin.sourceVersionId) || !Number.isSafeInteger(pin.revision))
    throw new DomainError('invalid_state', 'Choose a reviewed page.')
  const page = (
    await client.query<{ content: EditorSection[]; versionId: string; revision: number }>(
      `SELECT v.content,v.id AS "versionId",p.revision::int AS revision FROM pages p JOIN sites s ON s.id=p.site_id JOIN page_versions v ON v.id=p.draft_version_id
 WHERE p.id=$1 AND p.archived_at IS NULL AND s.status<>'archived' AND app.can_administer_site(s.id)`,
      [pin.pageId],
    )
  ).rows[0]
  if (!page) throw new DomainError('not_found', 'A chosen page is no longer available to update.')
  if (page.versionId !== pin.sourceVersionId || page.revision !== pin.revision)
    throw new DomainError('stale_revision', 'A page changed after this review. Refresh the page list before updating.')
  const inputs: UpgradeRequest[] = page.content.flatMap((section, index) =>
    section.section_def_id === definitionId && section.section_def_version < targetVersion
      ? [{ pageId: pin.pageId, sourceVersionId: pin.sourceVersionId, index, targetVersion }]
      : [],
  )
  if (!inputs.length)
    throw new DomainError('stale_revision', 'This page no longer needs the reviewed update. Refresh the page list.')
  return inputs
}
export async function previewSectionPageUpdate(
  client: Queryable,
  siteId: string,
  definitionId: string,
  targetVersion: number,
  pin: SectionPagePin,
) {
  await sectionUpdateAccess(client, siteId, definitionId, targetVersion)
  const inputs = await checkedInputs(client, definitionId, targetVersion, pin)
  const result = await renderUpgradeSet(client, inputs)
  // A concurrent save during rendering must not produce an apparently current review.
  await checkedInputs(client, definitionId, targetVersion, pin)
  return result
}
/** One transaction, sorted page locks, existing narrow CAS commands, no live writes. */
export async function applySectionPageUpdates(
  client: Queryable,
  siteId: string,
  definitionId: string,
  targetVersion: number,
  pins: SectionPagePin[],
) {
  const definition = await sectionUpdateAccess(client, siteId, definitionId, targetVersion)
  if (
    !Array.isArray(pins) ||
    !pins.length ||
    pins.length > 100 ||
    new Set(pins.map(pin => pin.pageId)).size !== pins.length
  )
    throw new DomainError('invalid_state', 'Choose between 1 and 100 different pages per update.')
  const ordered = [...pins].sort((a, b) => a.pageId.localeCompare(b.pageId))
  if (ordered.some(pin => !uuid.test(pin.pageId))) throw new DomainError('invalid_state', 'Choose a reviewed page.')
  await client.query('SELECT id FROM pages WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
    ordered.map(pin => pin.pageId),
  ])
  for (const pin of ordered) {
    const inputs = await checkedInputs(client, definitionId, targetVersion, pin)
    // Refuse incompatible list bindings or render-policy failures before any save.
    await renderUpgradeSet(client, inputs)
    const first = await loadSectionUpgrade(client, inputs[0]!),
      content = [...first.page.content]
    for (const input of inputs) {
      const { section, target, plan } = await loadSectionUpgrade(client, input)
      content[input.index] = { ...section, section_def_version: target.version, values: plan.values }
    }
    let revision = first.page.revision
    if (first.page.kind !== 'checkpoint')
      revision = (
        await client.query<{ revision: string }>('SELECT revision FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
          pin.pageId,
          revision,
          JSON.stringify(first.page.content),
          JSON.stringify(first.page.meta),
          'checkpoint',
          'Before section version update',
        ])
      ).rows[0]!.revision
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      pin.pageId,
      revision,
      JSON.stringify(content),
      JSON.stringify(first.page.meta),
      'checkpoint',
      `Updated ${definition.name} to version ${targetVersion}`,
    ])
  }
  return pins.length
}
