import 'server-only'
import { DomainError, type EditorSection } from '@cms/domain'
import type { Queryable } from '@cms/platform'
import { renderPage, renderSection, type RenderManifest, type SectionDefView } from '@cms/renderer'
import { repeatItemSpec, type SlotDef, type StructuredDocument } from '@cms/schema'
import { SCRIPTLESS_RENDER_OPTIONS } from './scriptless-preview.ts'
import { planSectionUpgrade, type SectionUpgradePlan } from './section-upgrade.ts'
import { readSitePreview } from './site-preview.ts'
import { sitePreviewContext, type SitePreviewContext } from './preview-context.ts'
export type UpgradeRequest = {
  pageId: string
  sourceVersionId: string
  index: number
  targetVersion: number
  previewContext?: SitePreviewContext
}
export async function loadSectionUpgrade(client: Queryable, input: UpgradeRequest, lock = false) {
  if (
    !Number.isSafeInteger(input.index) ||
    input.index < 0 ||
    !Number.isSafeInteger(input.targetVersion) ||
    input.targetVersion < 1
  ) {
    throw new DomainError('invalid_state', 'Choose a section and a valid target version.')
  }
  const page = (
    await client.query<{
      site_id: string
      revision: string
      version_id: string
      kind: string
      content: EditorSection[]
      meta: unknown
    }>(
      `
    SELECT p.site_id,p.revision,v.id AS version_id,v.kind,v.content,v.meta
    FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1 AND p.archived_at IS NULL${lock ? ' FOR UPDATE OF p' : ''}
  `,
      [input.pageId],
    )
  ).rows[0]
  if (!page) throw new DomainError('not_found', 'That page is no longer available.')
  if (page.version_id !== input.sourceVersionId)
    throw new DomainError(
      'stale_revision',
      'The page changed after the update preview. Reload to review the current draft.',
      Number(page.revision),
    )
  const section = page.content[input.index]
  if (!section || input.targetVersion <= section.section_def_version)
    throw new DomainError('invalid_state', 'Choose a newer version of this section.')
  const target = (
    await client.query<SectionDefView & { slots: SlotDef[]; structured_doc: StructuredDocument | null; name: string }>(
      `
    SELECT d.id AS section_def_id,d.slug,d.name,v.version,v.compiled_ast,v.compiled_css AS css,v.slots,
      v.sanitizer_policy_version,v.css_policy_version,v.render_hash,v.definition_kind,v.structured_doc,v.structured_schema_version
    FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
    WHERE d.id=$1 AND v.version=$2 AND d.status='active' AND (d.scope='global' OR d.site_id=$3)
  `,
      [section.section_def_id, input.targetVersion, page.site_id],
    )
  ).rows[0]
  if (!target) throw new DomainError('not_found', 'That section update is no longer available on this site.')
  const old = (
    await client.query<{ slots: SlotDef[] }>(
      'SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2',
      [section.section_def_id, section.section_def_version],
    )
  ).rows[0]
  if (!old) throw new DomainError('invalid_state', 'The current section could not be read.')
  return { page, section, target, plan: planSectionUpgrade(old.slots, target.slots, section.values) }
}

/** Render a whole reviewed page with all chosen placements updated together. */
export async function renderUpgradeSet(client: Queryable, inputs: UpgradeRequest[]) {
  if (!inputs.length) throw new DomainError('invalid_state', 'Choose a section update.')
  const first = inputs[0]!,
    { page } = await loadSectionUpgrade(client, first)
  if (inputs.some(input => input.pageId !== first.pageId || input.sourceVersionId !== first.sourceVersionId))
    throw new DomainError('invalid_state', 'Review one saved page at a time.')
  const manifest = (
    await client.query<{ manifest: RenderManifest }>('SELECT app.build_render_manifest($1) AS manifest', [
      page.version_id,
    ])
  ).rows[0]!.manifest
  const context = sitePreviewContext(first.previewContext),
    preview = await readSitePreview(client, page.site_id, context)
  if (!preview) throw new DomainError('not_found', 'The selected site look is no longer available.')
  const render = () =>
    renderPage({
      manifest,
      shell: preview.shell,
      isStaging: true,
      navigationPaths: { ...preview.navigationPaths, [manifest.page.id]: manifest.page.path },
      options: SCRIPTLESS_RENDER_OPTIONS,
    }).html
  const beforeHtml = render(),
    plans: Omit<SectionUpgradePlan, 'values'>[] = []
  for (const input of inputs) {
    const { target, plan } = await loadSectionUpgrade(client, input),
      previous = manifest.sections[input.index]!,
      values = { ...plan.values }
    for (const slot of target.slots)
      if (slot.kind === 'repeat' && !repeatItemSpec(slot) && Object.hasOwn(plan.values, slot.id))
        values[slot.id] = previous.instance.values?.[slot.id]
    const replacement = { def: target, instance: { ...previous.instance, values } }
    if (!replacement.instance.hidden && renderSection(replacement, input.index, SCRIPTLESS_RENDER_OPTIONS) === '')
      throw new DomainError(
        'invalid_state',
        'This layout cannot display the page’s current list. Open the page to choose a compatible layout.',
      )
    manifest.sections[input.index] = replacement
    plans.push({ added: plan.added, removed: plan.removed, changed: plan.changed })
  }
  return { html: render(), beforeHtml, previewContext: context, plans }
}
