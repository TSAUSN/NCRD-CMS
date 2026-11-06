'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { DomainError, type EditorSection } from '@cms/domain'
import { asUser, type Queryable } from '@cms/platform'
import { renderPage, sectionAppearanceSupport, type CompiledSection, type RenderManifest } from '@cms/renderer'
import type { SlotDef } from '@cms/schema'
import { currentSession } from '../../../lib/session.ts'
import { SCRIPTLESS_RENDER_OPTIONS } from '../../../lib/scriptless-preview.ts'
import { planImportedFieldUpdate, type FieldRename, type FieldSummary } from '../../../lib/imported-field-update.ts'
import { readSitePreview } from '../../../lib/site-preview.ts'
import { sitePreviewContext, type SitePreviewContext } from '../../../lib/preview-context.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { ActionResult } from '../../../lib/action-result.ts'

/** Update one imported section to the current field mapping (EDIT-02). The
 * plan is recomputed from the saved draft on every call, so the preview is
 * what is saved and nothing the browser sends can change it. */
export type ImportedUpdateRequest = {
  pageId: string
  sourceVersionId: string
  index: number
  previewContext?: SitePreviewContext
}
export type ImportedUpdatePreview =
  | {
      ok: true
      html: string
      previewContext: SitePreviewContext
      sectionLabel: string
      definitionName: string
      removed: FieldSummary[]
      added: FieldSummary[]
      renamed: FieldRename[]
      otherPages: number
    }
  | { ok: false; message: string }
export type ImportedUpdateResult =
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
const REFUSALS: Record<string, string> = {
  'not-imported': 'Only sections made by the V1 importer can be updated this way.',
  current: 'This section’s fields already match the current import mapping. There is nothing to update.',
  'looks-different':
    'Updating this section’s fields would change how it looks on the page, so it is left as it is. Ask for a manual review of this section instead.',
  unmappable: 'This section’s current markup cannot be mapped again safely, so it is left as it is.',
}
type DefinitionRow = {
  section_def_id: string
  slug: string
  name: string
  category: string | null
  scope: 'global' | 'site'
  site_id: string | null
  status: string
  version: number
  latest: number
  definition_kind: string | null
  source_css: string | null
  compiled_ast: CompiledSection
  compiled_css: string
  slots: SlotDef[]
  carries_trusted_code: boolean
}

async function load(client: Queryable, input: ImportedUpdateRequest, lock = false) {
  if (!Number.isSafeInteger(input.index) || input.index < 0 || !UUID.test(input.pageId))
    throw new DomainError('invalid_state', 'Choose a section to update.')
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
      'The page changed after this review. Review the update again.',
      Number(page.revision),
    )
  }
  const section = page.content[input.index]
  if (!section) throw new DomainError('invalid_state', 'That section is no longer on this page.')
  const def = (
    await client.query<DefinitionRow>(
      `
    SELECT d.id AS section_def_id,d.slug,d.name,d.category,d.scope,d.site_id,d.status,v.version,v.definition_kind,v.source_css,
      v.compiled_ast,v.compiled_css,v.slots,v.carries_trusted_code,
      (SELECT max(l.version) FROM section_def_versions l WHERE l.section_def_id=d.id)::int AS latest
    FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 AND v.version=$2
  `,
      [section.section_def_id, section.section_def_version],
    )
  ).rows[0]
  if (!def) throw new DomainError('invalid_state', 'This section’s layout could not be read.')
  if (def.latest !== def.version)
    throw new DomainError(
      'invalid_state',
      `A newer version of this layout exists. Review “Update to v${def.latest}” first.`,
    )
  if (def.status !== 'active') throw new DomainError('invalid_state', 'This layout is no longer active in the library.')
  const check = planImportedFieldUpdate(def, section.values ?? {})
  if (check.kind !== 'available') throw new DomainError('invalid_state', REFUSALS[check.kind]!)
  // Another page using this layout would keep the old fields on a version it
  // can no longer move to without losing content, so the update is per page.
  const otherPages = Number(
    (
      await client.query<{ count: string }>(
        `
    SELECT count(DISTINCT p.id) AS count FROM pages p JOIN page_versions v ON v.id IN (p.draft_version_id,p.published_version_id)
    WHERE p.id<>$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.content) s WHERE s->>'section_def_id'=$2)
  `,
        [input.pageId, def.section_def_id],
      )
    ).rows[0]!.count,
  )
  return { page, section, def, plan: check.plan, otherPages }
}

type Loaded = Awaited<ReturnType<typeof load>>

/** The page as the update would save it: the same site appearance and
 * manifest, with only this section moved to the new fields. */
async function render(client: Queryable, loaded: Loaded, index: number, context: SitePreviewContext): Promise<string> {
  const { page, def, plan } = loaded
  const manifest = (
    await client.query<{ manifest: RenderManifest }>('SELECT app.build_render_manifest($1) AS manifest', [
      page.version_id,
    ])
  ).rows[0]!.manifest
  const preview = await readSitePreview(client, page.site_id, context)
  if (!preview) throw new DomainError('not_found', 'The selected site preview settings are no longer available.')
  const previous = manifest.sections[index]!
  manifest.sections[index] = {
    def: {
      ...previous.def,
      version: def.version + 1,
      compiled_ast: plan.compiled.ast,
      css: plan.compiled.css,
      slots: plan.slots,
    },
    instance: { ...previous.instance, section_def_version: def.version + 1, values: plan.values },
  }
  return renderPage({
    manifest,
    shell: preview.shell,
    isStaging: true,
    navigationPaths: { ...preview.navigationPaths, [manifest.page.id]: manifest.page.path },
    options: SCRIPTLESS_RENDER_OPTIONS,
  }).html
}

export async function previewImportedFieldUpdate(input: ImportedUpdateRequest): Promise<ImportedUpdatePreview> {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin)
    return { ok: false, message: 'Only a super admin can update an imported section’s fields.' }
  try {
    return await asUser({ userId: session.principal.userId }, async client => {
      const loaded = await load(client, input)
      const context = sitePreviewContext(input.previewContext)
      return {
        ok: true,
        html: await render(client, loaded, input.index, context),
        previewContext: context,
        sectionLabel: loaded.section.label || loaded.def.name,
        definitionName: loaded.def.name,
        removed: loaded.plan.removed,
        added: loaded.plan.added,
        renamed: loaded.plan.renamed,
        otherPages: loaded.otherPages,
      }
    })
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError ? error.message : 'The update could not be reviewed. Your page is unchanged.',
    }
  }
}

export async function applyImportedFieldUpdate(
  input: ImportedUpdateRequest,
  expectedRevision: number,
): Promise<ImportedUpdateResult> {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin)
    return { ok: false, kind: 'error', message: 'Only a super admin can update an imported section’s fields.' }
  try {
    const outcome = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const loaded = await load(client, input, true)
      const { page, section, def, plan, otherPages } = loaded
      if (String(expectedRevision) !== page.revision)
        throw new DomainError(
          'stale_revision',
          'The page changed after you reviewed this update.',
          Number(page.revision),
        )
      if (otherPages > 0) {
        throw new DomainError(
          'invalid_state',
          `This layout is also used on ${otherPages} other ${otherPages === 1 ? 'page' : 'pages'}, so its fields cannot be updated from one of them.`,
        )
      }
      const label = section.label || def.name
      const changes = [
        ...(plan.removed.length || plan.added.length
          ? [
              `${plan.removed.map(field => field.label).join(', ')} → ${plan.added.map(field => field.label).join(', ')}`,
            ]
          : []),
        ...(plan.renamed.length
          ? [`renamed ${plan.renamed.map(field => `${field.from} → ${field.to}`).join(', ')}`]
          : []),
      ].join('; ')
      // The governed authoring command: super admin only for source definitions,
      // compare-and-set on the version reviewed, and its own policy checks.
      const saved = (
        await client.query<{ section_def_id: string; version: number }>(
          'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
          [
            def.slug,
            def.name,
            def.category ?? 'Imported',
            plan.sourceHtml,
            def.source_css ?? '',
            plan.compiled.css,
            JSON.stringify(plan.compiled.ast),
            JSON.stringify(plan.slots),
            plan.compiled.renderHash,
            plan.compiled.ast.policyVersion,
            plan.compiled.ast.cssPolicyVersion,
            `Fields updated to the current import mapping: ${changes}`.slice(0, 1000),
            plan.compiled.carriesTrustedCode,
            'legacy',
            null,
            null,
            def.scope,
            def.site_id,
            def.version,
            def.section_def_id,
          ],
        )
      ).rows[0]!
      let revision = page.revision
      if (page.kind !== 'checkpoint') {
        revision = (
          await client.query<{ revision: string }>('SELECT revision FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
            input.pageId,
            revision,
            JSON.stringify(page.content),
            JSON.stringify(page.meta),
            'checkpoint',
            `Before updating the imported fields of “${label}”`,
          ])
        ).rows[0]!.revision
      }
      const updated: EditorSection = { ...section, section_def_version: saved.version, values: plan.values }
      const content = [...page.content]
      content[input.index] = updated
      const draft = (
        await client.query<{ version_id: string; revision: string }>(
          'SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)',
          [
            input.pageId,
            revision,
            JSON.stringify(content),
            JSON.stringify(page.meta),
            'checkpoint',
            `Updated the imported fields of “${label}”`,
          ],
        )
      ).rows[0]!
      const view = {
        section_def_id: def.section_def_id,
        version: saved.version,
        slug: def.slug,
        compiled_ast: plan.compiled.ast,
        slots: plan.slots,
        definition_kind: 'legacy',
        structured_doc: null,
      }
      const definition: LibraryEntry = {
        section_def_id: def.section_def_id,
        slug: def.slug,
        name: def.name,
        category: def.category ?? 'Imported',
        version: saved.version,
        slots: plan.slots,
        thumbnail_path: null,
        definition_kind: 'legacy',
        carries_trusted_code: plan.compiled.carriesTrustedCode,
        used_on_pages: 1,
        used_on_sites: 1,
        scope: def.scope,
        site_id: def.site_id,
        placement: 'page',
        appearance_support: sectionAppearanceSupport({ ...view, css: plan.compiled.css }),
      } as LibraryEntry
      return { draft, section: updated, definition }
    })
    revalidatePath(`/pages/${input.pageId}`)
    return {
      ok: true,
      revision: Number(outcome.draft.revision),
      versionId: outcome.draft.version_id,
      section: outcome.section,
      definition: outcome.definition,
      message:
        'Fields updated in the draft. The page looks the same; the earlier fields are kept in page history, and Undo restores them. The live page is unchanged.',
    }
  } catch (error) {
    if (error instanceof DomainError && error.kind === 'stale_revision')
      return { ok: false, kind: 'conflict', currentRevision: error.currentRevision, message: error.message }
    return {
      ok: false,
      kind: 'error',
      message:
        error instanceof DomainError ? error.message : 'The update could not be confirmed. Reload before trying again.',
    }
  }
}
