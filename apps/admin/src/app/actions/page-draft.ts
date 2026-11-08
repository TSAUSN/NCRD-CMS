'use server'
import { savePageIdentity, validPageIdentity } from '../../lib/page-identity.ts'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { mergeEditedPageMeta, readEditedPageMeta } from '../../lib/page-meta-edit.ts'
import { validateAppearanceEdits } from '../../lib/section-appearance.ts'
import { ActionResult, requireSession, toActionResult } from '../../lib/action-result.ts'

export async function savePageDraft(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const pageId = String(formData.get('pageId'))
  const expectedRevision = Number(formData.get('revision'))
  const content = String(formData.get('content'))
  let identity: unknown
  try {
    identity = formData.has('identity') ? JSON.parse(String(formData.get('identity'))) : undefined
  } catch {
    return { ok: false, kind: 'error', message: 'The page details are invalid.' }
  }
  if (identity !== undefined && !validPageIdentity(identity))
    return { ok: false, kind: 'error', message: 'Enter a page name and a valid page address.' }
  // The one server-side boundary page metadata passes through. `SeoMeta` was
  // exported but never called, so every constraint it declared
  // was aspirational; validating in the form component instead would put the
  // check on the side of the wire the author controls.
  const parsedMeta = readEditedPageMeta(formData)
  if (!parsedMeta.ok) {
    const [first] = parsedMeta.problems
    return {
      ok: false,
      kind: 'error',
      message:
        first === undefined
          ? 'The page metadata could not be saved.'
          : `The page metadata could not be saved: ${first.field} — ${first.message}`,
    }
  }
  const meta = parsedMeta.fields
  // Autosaves are rolling and prunable; a deliberate Save draft is a checkpoint
  // and is permanent.
  const kind = formData.get('kind') === 'autosave' ? 'autosave' : 'checkpoint'

  let parsedContent: unknown
  try {
    parsedContent = JSON.parse(content)
  } catch {
    return { ok: false, kind: 'error', message: 'The section content is not valid JSON.' }
  }

  try {
    const saved = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      await validateAppearanceEdits(client, parsedContent)
      const previous = (
        await client.query<{ title: string; slug: string; meta: unknown }>(
          'SELECT p.title,p.slug,v.meta FROM pages p LEFT JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [pageId],
        )
      ).rows[0]
      const merged = mergeEditedPageMeta(previous?.meta, meta)
      if (!merged.ok)
        throw new DomainError(
          'invalid_state',
          merged.problems.map(problem => `${problem.field}: ${problem.message}`).join(' '),
        )
      const renamed =
        identity !== undefined && (previous?.title !== identity.title || previous?.slug !== identity.address)
          ? identity
          : undefined
      const revision = renamed ? await savePageIdentity(client, pageId, expectedRevision, renamed) : expectedRevision
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.save_page_draft($1,$2,$3,$4,$5,$6)',
        [
          pageId,
          revision,
          content,
          JSON.stringify(merged.meta),
          kind,
          kind === 'autosave' ? '' : 'Saved from the editor',
        ],
      )
      return {
        versionId: rows[0]!.version_id,
        revision: Number(rows[0]!.revision),
        identityChanged: renamed !== undefined,
      }
    })
    // The editor applies the receipt and refreshes its canvas. Only an explicit
    // address or title change needs new route props.
    if (kind === 'checkpoint' && saved.identityChanged) revalidatePath(`/pages/${pageId}`)
    return {
      ok: true,
      revision: saved.revision,
      versionId: saved.versionId,
      message: 'All changes saved. The live site is not affected.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

/**
 * Turn an immutable historical version into a new draft.
 *
 * The source id and expected revision both come from the browser, so neither is
 * trusted: the database verifies page ownership, site access, archived state,
 * and the current head under one lock before it creates anything. Publication
 * is deliberately untouched.
 */
export async function restorePageVersionAsDraft(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const pageId = String(formData.get('pageId') ?? '')
  const sourceVersionId = String(formData.get('sourceVersionId') ?? '')
  // Keep the revision as an exact decimal string. PostgreSQL validates and
  // casts it to bigint; a JavaScript Number would silently round large heads.
  const expectedRevision = String(formData.get('revision') ?? '')

  try {
    const restored = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.restore_version_as_draft($1,$2,$3,$4)',
        [pageId, expectedRevision, sourceVersionId, 'Restored from page history'],
      )
      return { versionId: rows[0]!.version_id, revision: Number(rows[0]!.revision) }
    })
    revalidatePath(`/pages/${pageId}`)
    revalidatePath(`/pages/${pageId}/history`)
    return {
      ok: true,
      revision: restored.revision,
      versionId: restored.versionId,
      message: 'A new draft was created from that version. The live page was not changed.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}
