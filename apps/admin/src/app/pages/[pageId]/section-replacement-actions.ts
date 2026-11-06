'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { DomainError, type EditorSection } from '@cms/domain'
import { asUser, type Queryable } from '@cms/platform'
import {
  renderPage,
  renderSection,
  sectionAppearanceSupport,
  type RenderManifest,
  type SectionDefView,
} from '@cms/renderer'
import type { SlotDef, StructuredDocument } from '@cms/schema'
import { currentSession } from '../../../lib/session.ts'
import { SCRIPTLESS_RENDER_OPTIONS } from '../../../lib/scriptless-preview.ts'
import {
  planSectionReplacement,
  replacementSection,
  type ReplacementField,
  type ReplacementMapping,
} from '../../../lib/section-replacement.ts'
import { readSitePreview } from '../../../lib/site-preview.ts'
import { sitePreviewContext, type SitePreviewContext } from '../../../lib/preview-context.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { ActionResult } from '../../../lib/action-result.ts'

/** Change one section to a different layout (LIB-11). The mapping says which
 * current field fills each field of the new layout; preview and apply compute
 * the replacement with the same function, so the preview is what is saved. */
export type ReplacementRequest = {
  pageId: string
  sourceVersionId: string
  index: number
  targetDefinitionId: string
  mapping?: ReplacementMapping
  previewContext?: SitePreviewContext
}
export type ReplacementPreview =
  | {
      ok: true
      html: string
      beforeHtml: string
      previewContext: SitePreviewContext
      sectionLabel: string
      currentName: string
      target: { definitionId: string; name: string; version: number }
      fields: ReplacementField[]
      unmapped: string[]
      droppedAppearance: string[]
      droppedSource: boolean
    }
  | { ok: false; message: string }
export type ReplacementResult =
  | (ActionResult & { ok: false })
  | {
      ok: true
      revision: number
      versionId: string
      message: string
      section: EditorSection
      definition: LibraryEntry
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type TargetRow = SectionDefView &
  LibraryEntry & { slots: SlotDef[]; structured_doc: StructuredDocument | null; css: string }

function checkedMapping(mapping: unknown): ReplacementMapping | undefined {
  if (mapping === undefined) return undefined
  if (
    !mapping ||
    typeof mapping !== 'object' ||
    Array.isArray(mapping) ||
    Object.keys(mapping).length > 256 ||
    Object.values(mapping).some(value => value !== null && (typeof value !== 'string' || value.length > 64))
  ) {
    throw new DomainError('invalid_state', 'Review the field choices again before changing this layout.')
  }
  return mapping as ReplacementMapping
}

async function load(client: Queryable, input: ReplacementRequest, lock = false) {
  if (
    !Number.isSafeInteger(input.index) ||
    input.index < 0 ||
    !UUID.test(input.pageId) ||
    !UUID.test(input.targetDefinitionId)
  ) {
    throw new DomainError('invalid_state', 'Choose a section and a layout for it.')
  }
  const mapping = checkedMapping(input.mapping)
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
  if (page.version_id !== input.sourceVersionId) {
    throw new DomainError(
      'stale_revision',
      'The page changed after this layout preview. Review the change again.',
      Number(page.revision),
    )
  }
  const section = page.content[input.index]
  if (!section) throw new DomainError('invalid_state', 'That section is no longer on this page.')
  if (section.section_def_id === input.targetDefinitionId) {
    throw new DomainError(
      'invalid_state',
      'This section already uses that layout. Use “Review update” to move to a newer version of the same layout.',
    )
  }
  // Only page layouts this site may use. Frame components and retired
  // definitions are never valid replacements for a page section.
  const target = (
    await client.query<TargetRow>(
      `
    SELECT d.id AS section_def_id,d.slug,d.name,d.category,d.scope,d.site_id,d.placement,v.version,v.compiled_ast,v.compiled_css AS css,
      v.slots,v.sanitizer_policy_version,v.css_policy_version,v.render_hash,v.definition_kind,v.structured_doc,v.structured_schema_version,
      v.thumbnail_path,v.carries_trusted_code,0::int AS used_on_pages,0::int AS used_on_sites
    FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
    WHERE d.id=$1 AND d.status='active' AND d.placement='page' AND (d.scope='global' OR d.site_id=$2)
    ORDER BY v.version DESC LIMIT 1
  `,
      [input.targetDefinitionId, page.site_id],
    )
  ).rows[0]
  if (!target) throw new DomainError('not_found', 'That layout is not available on this site.')
  const current = (
    await client.query<{ name: string; slots: SlotDef[] }>(
      `
    SELECT d.name,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 AND v.version=$2
  `,
      [section.section_def_id, section.section_def_version],
    )
  ).rows[0]
  if (!current) throw new DomainError('invalid_state', 'The current layout of this section could not be read.')
  const { css, structured_doc, ...definition } = target
  const support = sectionAppearanceSupport({ ...definition, css, structured_doc })
  const entry: LibraryEntry = {
    section_def_id: target.section_def_id,
    slug: target.slug,
    name: target.name,
    category: target.category,
    version: target.version,
    slots: target.slots,
    thumbnail_path: target.thumbnail_path,
    definition_kind: target.definition_kind ?? 'legacy',
    carries_trusted_code: target.carries_trusted_code,
    used_on_pages: 0,
    used_on_sites: 0,
    scope: target.scope,
    site_id: target.site_id,
    placement: 'page',
    appearance_support: support,
  }
  let plan: ReturnType<typeof planSectionReplacement>
  try {
    plan = planSectionReplacement(current.slots, target.slots, section.values, mapping)
  } catch (error) {
    throw new DomainError('invalid_state', (error as Error).message)
  }
  const carried = replacementSection(
    section,
    { section_def_id: target.section_def_id, version: target.version, appearance_support: support },
    plan.values,
  )
  return { page, section, target, entry, current, mapping, plan, carried }
}

type Loaded = Awaited<ReturnType<typeof load>>
/** Render the page as it is and as the replacement would save it, from one
 * loaded site appearance, and refuse a layout that cannot show this section. */
async function render(client: Queryable, loaded: Loaded, index: number, context: SitePreviewContext) {
  const { page, target, current, mapping, carried } = loaded
  const manifest = (
    await client.query<{ manifest: RenderManifest }>('SELECT app.build_render_manifest($1) AS manifest', [
      page.version_id,
    ])
  ).rows[0]!.manifest
  const preview = await readSitePreview(client, page.site_id, context)
  if (!preview) throw new DomainError('not_found', 'The selected site preview settings are no longer available.')
  const html = () =>
    renderPage({
      manifest,
      shell: preview.shell,
      isStaging: true,
      navigationPaths: { ...preview.navigationPaths, [manifest.page.id]: manifest.page.path },
      options: SCRIPTLESS_RENDER_OPTIONS,
    }).html
  const beforeHtml = html()
  const previous = manifest.sections[index]!
  // The manifest holds resolved collection data for repeat fields; map those
  // through the same choices so the preview shows what the saved binding renders.
  const resolved = planSectionReplacement(current.slots, target.slots, previous.instance.values ?? {}, mapping).values
  const { raw_html: _raw, custom_css: _css, appearance: _appearance, ...instance } = previous.instance
  const replacement = { def: target, instance: { ...instance, ...carried.section, values: resolved } }
  if (
    renderSection(
      { ...replacement, instance: { ...replacement.instance, hidden: false, hidden_at: [] } },
      index,
      SCRIPTLESS_RENDER_OPTIONS,
    ) === ''
  ) {
    throw new DomainError(
      'invalid_state',
      'The new layout cannot show this section’s content, for example because its collection binding does not fit. Add the layout as a separate section and configure it there instead.',
    )
  }
  manifest.sections[index] = replacement
  const sectionHtml = renderPage({
    manifest: { ...manifest, sections: [replacement] },
    shell: preview.shell,
    isStaging: true,
    navigationPaths: preview.navigationPaths,
    options: { ...SCRIPTLESS_RENDER_OPTIONS, sectionOnly: true },
  }).html
  return { beforeHtml, html: html(), sectionHtml }
}

export async function previewSectionReplacement(input: ReplacementRequest): Promise<ReplacementPreview> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in to review this layout change.' }
  try {
    return await asUser({ userId: session.principal.userId }, async client => {
      const loaded = await load(client, input)
      const context = sitePreviewContext(input.previewContext)
      const { beforeHtml, html } = await render(client, loaded, input.index, context)
      return {
        ok: true,
        html,
        beforeHtml,
        previewContext: context,
        sectionLabel: loaded.section.label || loaded.current.name,
        currentName: loaded.current.name,
        target: {
          definitionId: loaded.target.section_def_id,
          name: loaded.target.name,
          version: loaded.target.version,
        },
        fields: loaded.plan.fields,
        unmapped: loaded.plan.unmapped,
        droppedAppearance: loaded.carried.droppedAppearance,
        droppedSource: loaded.carried.droppedSource,
      }
    })
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The layout preview could not be loaded. Your page is unchanged.',
    }
  }
}

export async function applySectionReplacement(
  input: ReplacementRequest,
  expectedRevision: number,
): Promise<ReplacementResult> {
  const session = await currentSession()
  if (!session) return { ok: false, kind: 'error', message: 'Sign in before changing this layout.' }
  try {
    const outcome = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const loaded = await load(client, input, true)
      const { page, section, target, current, carried } = loaded
      if (String(expectedRevision) !== page.revision)
        throw new DomainError(
          'stale_revision',
          'The page changed after you reviewed this layout change.',
          Number(page.revision),
        )
      await render(client, loaded, input.index, 'published')
      const label = section.label || current.name
      let revision = page.revision
      // The previous layout and every value it held stay in page history, even
      // when the new layout has nowhere to put some of them.
      if (page.kind !== 'checkpoint') {
        revision = (
          await client.query<{ revision: string }>('SELECT revision FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
            input.pageId,
            revision,
            JSON.stringify(page.content),
            JSON.stringify(page.meta),
            'checkpoint',
            `Before changing the layout of “${label}”`,
          ])
        ).rows[0]!.revision
      }
      const content = [...page.content]
      content[input.index] = carried.section
      const saved = (
        await client.query<{ version_id: string; revision: string }>(
          'SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)',
          [
            input.pageId,
            revision,
            JSON.stringify(content),
            JSON.stringify(page.meta),
            'checkpoint',
            `Changed “${label}” from ${current.name} to ${target.name}`,
          ],
        )
      ).rows[0]!
      return { saved, section: carried.section, definition: loaded.entry }
    })
    revalidatePath(`/pages/${input.pageId}`)
    return {
      ok: true,
      revision: Number(outcome.saved.revision),
      versionId: outcome.saved.version_id,
      section: outcome.section,
      definition: outcome.definition,
      message:
        'Layout changed in the draft. The previous layout is kept in page history, and Undo restores it. The live page is unchanged.',
    }
  } catch (error) {
    if (error instanceof DomainError && error.kind === 'stale_revision')
      return { ok: false, kind: 'conflict', currentRevision: error.currentRevision, message: error.message }
    return {
      ok: false,
      kind: 'error',
      message:
        error instanceof DomainError
          ? error.message
          : 'The layout change could not be confirmed. Reload before trying again.',
    }
  }
}

export type ReplacementOption = { definition: LibraryEntry; html: string; notCarried: string[] }
/** Only successfully rendered, content-bearing choices reach the chooser. */
export async function listCompatibleSectionLayouts(
  input: Omit<ReplacementRequest, 'targetDefinitionId' | 'mapping'>,
): Promise<{ ok: true; options: ReplacementOption[] } | { ok: false; message: string }> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in to choose a layout.' }
  try {
    return await asUser({ userId: session.principal.userId }, async client => {
      const ids = (
        await client.query<{ id: string }>(
          `SELECT d.id FROM section_defs d JOIN pages p ON p.id=$1 WHERE d.status='active' AND d.placement='page' AND (d.scope='global' OR d.site_id=p.site_id) ORDER BY d.name`,
          [input.pageId],
        )
      ).rows
      const options: ReplacementOption[] = []
      for (const { id } of ids) {
        try {
          const loaded = await load(client, { ...input, targetDefinitionId: id })
          if (
            !loaded.plan.fields.some(
              field =>
                field.sourceId &&
                loaded.section.values[field.sourceId] !== undefined &&
                loaded.section.values[field.sourceId] !== '',
            )
          )
            continue
          // A list needs an existing compatible binding. Never replace it with illustrative people.
          if (loaded.target.slots.some(field => field.kind === 'repeat' && !loaded.plan.values[field.id])) continue
          const rendered = await render(client, loaded, input.index, sitePreviewContext(input.previewContext))
          const notCarried = loaded.plan.unmapped.filter(label =>
            loaded.current.slots.some(
              field =>
                field.label === label &&
                loaded.section.values[field.id] !== undefined &&
                loaded.section.values[field.id] !== '',
            ),
          )
          options.push({ definition: loaded.entry, html: rendered.sectionHtml, notCarried })
        } catch (error) {
          if (!(error instanceof DomainError)) throw error
        }
      }
      return { ok: true as const, options }
    })
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'The layouts could not be loaded. Try again.',
    }
  }
}
