'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { scopeCss, sectionScopeSelector, CSS_POLICY_VERSION } from '@cms/renderer'
import { DomainError } from '@cms/domain'
import { getSiteShell } from '../../lib/queries.ts'
import { compileDefinitionDraft, type AuthoredCompilation } from '../../lib/definition-compiler.ts'
import { renderDefinitionPreview } from '../../lib/definition-preview-render.ts'
import { sitePreviewContext, type SitePreviewContext } from '../../lib/preview-context.ts'
import { ActionResult, requireSession, toActionResult, UUID } from '../../lib/action-result.ts'

/**
 * Only accept authored markup and CSS. Recompute the compiled AST, scoped stylesheet, render hash,
 * policy versions and trusted-code flag on the server. A client cannot clear a flag to bypass
 * review.
 */
export type SectionDraft = {
  slug: string
  name: string
  category: string
  sourceHtml: string
  sourceCss: string
  slots: { id: string; kind: string; label: string; constraints?: Record<string, unknown> }[]
  changelog: string
  /**
   * `global` offers this section to every site; `site` offers it to one.
   *
   * The choice is the author's and the *permission* is the database's:
   * migration 0029 lets a site admin author a site section and keeps a global
   * one a super admin's decision. The browser sends the intent and never the
   * verdict.
   */
  scope: 'global' | 'site'
  siteId: string
  definitionKind?: 'legacy' | 'structured'
  placement?: 'page' | 'header' | 'footer'
  structuredDoc?: unknown
  /** Preview-only appearance; never saved with the definition. */
  previewContext?: SitePreviewContext
  expectedVersion?: number
  definitionId?: string
}

export type SectionCompileReport = {
  ok: boolean
  /** Refusals. The definition cannot be stored while any of these stand. */
  blocking: string[]
  /** Things worth fixing that do not make the definition unsafe. */
  problems: string[]
  /** True when this template contains markup only a super admin may publish. */
  carriesTrustedCode: boolean
  /** A whole document, ready for a sandboxed iframe. Null when blocking. */
  previewHtml: string | null
}

/**
 * Compile a draft definition and say what is wrong with it, without storing
 * anything.
 *
 * The creator's mandatory preview step is this function's output: an
 * author sees the section rendered by the real renderer from the real compiled
 * artifacts, not by a second approximation written for the creator screen. If
 * this and the save disagreed about anything, the preview would be a picture of
 * a section nobody is about to store.
 */
async function checkDefinitionAuthoring(userId: string, draft: SectionDraft, compiled: AuthoredCompilation) {
  await asUser({ userId }, client =>
    client.query('SELECT app.check_section_authoring($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      draft.slug,
      draft.siteId,
      draft.scope,
      compiled.kind,
      draft.sourceHtml,
      draft.sourceCss,
      compiled.css,
      JSON.stringify(compiled.ast),
      JSON.stringify(compiled.slots),
      compiled.structuredDoc ? JSON.stringify(compiled.structuredDoc) : null,
      compiled.carriesTrustedCode,
      draft.placement ?? 'page',
    ]),
  )
}

export async function compileSectionDraft(draft: SectionDraft): Promise<SectionCompileReport> {
  const session = await requireSession()
  const scope = sectionScopeSelector(draft.slug)
  if (scope === null) {
    return {
      ok: false,
      blocking: ['A section needs a short name made of lowercase letters, numbers and hyphens.'],
      problems: [],
      carriesTrustedCode: false,
      previewHtml: null,
    }
  }

  const compiled = compileDefinitionDraft(draft)
  const slots = compiled.slots
  if (compiled.blocking.length > 0) {
    return {
      ok: false,
      blocking: compiled.blocking,
      problems: compiled.problems,
      carriesTrustedCode: compiled.carriesTrustedCode,
      previewHtml: null,
    }
  }

  try {
    await checkDefinitionAuthoring(session.principal.userId, draft, compiled)
  } catch (error) {
    return {
      ok: false,
      blocking: [toActionResult(error).message],
      problems: [],
      carriesTrustedCode: false,
      previewHtml: null,
    }
  }

  const shellContext = await getSiteShell(
    session.principal.userId,
    draft.siteId,
    sitePreviewContext(draft.previewContext),
  )
  if (!shellContext)
    return {
      ok: false,
      blocking: ['This site or its selected preview settings are no longer available.'],
      problems: compiled.problems,
      carriesTrustedCode: compiled.carriesTrustedCode,
      previewHtml: null,
    }
  const html = renderDefinitionPreview({
    name: draft.name,
    placement: draft.placement,
    preview: shellContext,
    definition: {
      // Frame configuration requires a UUID even for an unsaved component.
      section_def_id: '00000000-0000-4000-8000-000000000001',
      version: 1,
      slug: draft.slug,
      compiled_ast: compiled.ast,
      css: compiled.css,
      css_policy_version: CSS_POLICY_VERSION,
      sanitizer_policy_version: compiled.ast.policyVersion,
      slots,
      definition_kind: compiled.kind,
      structured_doc: compiled.structuredDoc,
      structured_schema_version: compiled.schemaVersion,
    },
  })

  return {
    ok: true,
    blocking: [],
    problems: compiled.problems,
    carriesTrustedCode: compiled.carriesTrustedCode,
    previewHtml: html,
  }
}

/**
 * Save a section definition — the creator's last step.
 *
 * Compiled a second time here rather than trusting the report the preview
 * returned, because the report went to the browser and came back. The database
 * command then re-runs its own gates over the artifacts and creates version
 * N+1, never mutating N, so a page pinned to an older version goes on rendering
 * exactly what it rendered before.
 */
export async function saveSectionDefinition(draft: SectionDraft): Promise<ActionResult> {
  const session = await requireSession()
  const cssScope = sectionScopeSelector(draft.slug)
  if (cssScope === null) {
    return {
      ok: false,
      kind: 'error',
      message: 'A section needs a short name made of lowercase letters, numbers and hyphens.',
    }
  }
  if (draft.name.trim() === '') {
    return { ok: false, kind: 'error', message: 'A section needs a name people will recognise in the library.' }
  }

  if (typeof draft.changelog !== 'string' || !draft.changelog.trim()) {
    return { ok: false, kind: 'error', message: 'Describe what changed before saving this section.' }
  }

  const compiled = compileDefinitionDraft(draft)
  const slots = compiled.slots
  if (compiled.blocking.length > 0) {
    return { ok: false, kind: 'error', message: compiled.blocking.join(' ') }
  }

  let savedVersion = 0
  try {
    await checkDefinitionAuthoring(session.principal.userId, draft, compiled)
    savedVersion = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ section_def_id: string; version: number }>(
        'SELECT section_def_id, version FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          draft.slug,
          draft.name.trim(),
          draft.category.trim() || 'Other',
          compiled.sourceHtml,
          draft.sourceCss,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          draft.changelog.trim() || 'Saved from the section creator',
          compiled.carriesTrustedCode,
          compiled.kind,
          compiled.structuredDoc ? JSON.stringify(compiled.structuredDoc) : null,
          compiled.schemaVersion,
          draft.scope,
          draft.scope === 'site' ? draft.siteId : null,
          draft.expectedVersion ?? 0,
          draft.definitionId ?? null,
        ],
      )
      const saved = rows[0]!
      if (draft.placement !== undefined) {
        const current = (
          await client.query<{ placement: string }>('SELECT placement FROM section_defs WHERE id=$1', [
            saved.section_def_id,
          ])
        ).rows[0]
        if (current?.placement !== draft.placement) {
          await client.query('SELECT app.set_section_def_placement($1,$2)', [saved.section_def_id, draft.placement])
        }
      }
      return saved.version
    })
  } catch (error) {
    if (error instanceof DomainError && error.kind === 'stale_revision')
      return {
        ok: false,
        kind: 'conflict',
        currentRevision: error.currentRevision,
        message:
          'A newer section version exists. Your changes are still here; compare them with the latest section before saving.',
      }
    return toActionResult(error)
  }
  revalidatePath('/', 'layout')
  return {
    ok: true,
    revision: savedVersion,
    versionId: null,
    message: compiled.carriesTrustedCode
      ? `“${draft.name}” was saved. It contains custom code, so a super admin has to approve any page that uses it before that page can go live.`
      : draft.placement === 'header' || draft.placement === 'footer'
        ? `“${draft.name}” version ${savedVersion} was saved. Choose it in Header & footer; existing site frames keep their pinned version until deliberately updated.`
        : `“${draft.name}” version ${savedVersion} was saved. Existing pages keep their current version until an editor applies this update.`,
  }
}

export type CssCheck = {
  ok: boolean
  /** Rules the policy refuses outright. None of the stylesheet is used. */
  blocking: string[]
  /** Rules it dropped. The rest is used; these are not. */
  dropped: string[]
}

/**
 * What the CSS policy makes of one section's custom stylesheet.
 *
 * The same `scopeCss` call the renderer makes, with the same block selector, so
 * the answer an author is shown is the answer the page will act on rather than a
 * second opinion written for a form. Without this the failure was silent in the
 * worst way available: the stylesheet was stored, the page version was escalated
 * to needing a super admin's review because of it, and then nothing changed on
 * the page and nothing said why.
 */
export async function checkCustomCss(css: string, index: number): Promise<CssCheck> {
  const session = await requireSession()
  const allowed = await asUser(
    { userId: session.principal.userId },
    async client =>
      (await client.query<{ allowed: boolean }>('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed === true,
  )
  if (!allowed)
    return {
      ok: false,
      blocking: [
        'Only a super admin can author custom section CSS. You can keep editing ordinary content while preserving existing code.',
      ],
      dropped: [],
    }
  if (css.trim() === '') return { ok: true, blocking: [], dropped: [] }
  const scoped = scopeCss(css, `#s${index}`)
  return {
    ok: scoped.blocking.length === 0,
    blocking: scoped.blocking,
    // `violations` includes rules that were dropped as empty, which is not
    // something to put in front of anybody: a rule with no declarations
    // contributes nothing whether it ships or not.
    dropped: scoped.violations.filter(problem => !problem.includes('no declarations')),
  }
}

/**
 * A super admin clearing the custom code on one draft version.
 *
 * The version id is the *draft* the editor is looking at, and approval is
 * deliberately per-version rather than per-page: a page that was approved once
 * and then had a script pasted into it would otherwise be publishable on the
 * strength of a review of something else. Saving again creates a new version
 * and the approval does not follow it, which is the property that makes this
 * safe to expose beside the code rather than in a separate queue.
 *
 * `app.approve_trusted_code` re-checks that the caller is a super admin, so
 * this action is a transport and not a permission.
 */
export async function approveTrustedCode(versionId: string): Promise<ActionResult> {
  const session = await requireSession()
  try {
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.approve_trusted_code($1)', [versionId]),
    )
  } catch (error) {
    return toActionResult(error)
  }
  revalidatePath('/', 'layout')
  return {
    ok: true,
    revision: 0,
    versionId,
    message: 'You have approved the custom code on this draft. It can be published now.',
  }
}
