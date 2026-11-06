'use server'
import { corePageContent } from '../../lib/core-pages.ts'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { sectionStartingValues, markSampleValues, clearSampleField, type SlotDef } from '@cms/schema'
import { ActionResult, requireSession, toActionResult, UUID, messageFor } from '../../lib/action-result.ts'

type PageStarterRow = {
  section_def_id: string
  version: number
  slots: SlotDef[]
}

/**
 * Create a page and its chosen starting structure atomically, then open it.
 *
 * Section ids are only requests. The server resolves active definitions and
 * their latest versions through the reader's own RLS-scoped connection; the
 * browser cannot pin a version that does not exist or smuggle a compiled
 * artifact into page content. `asUser` wraps page creation and the first saved
 * version in one transaction, so a refused starter cannot leave a ghost page.
 *
 * A redirect rather than a result, because there is exactly one thing anybody
 * wants after creating a page and it is not another list. `redirect` throws to
 * unwind the request, so it has to be outside the try — catching it would turn
 * the success path into "an unexpected error occurred".
 */
export async function createPage(formData: FormData): Promise<void> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  // An empty slug is the home page, which is a real answer rather than a
  // missing one — `app.page_path` maps it to `/`.
  const slug = String(formData.get('slug') ?? '').trim()
  const requested = [...new Set(formData.getAll('sectionDefId').map(String))]

  if (title === '') redirect(`/sites/${siteId}?error=${encodeURIComponent('A page needs a name.')}`)
  if (requested.length > 12) {
    redirect(
      `/sites/${siteId}?error=${encodeURIComponent('Start with at most 12 sections. You can add more in the editor.')}`,
    )
  }
  if (requested.some(id => !UUID.test(id))) {
    redirect(`/sites/${siteId}?error=${encodeURIComponent('One of those starting sections is not valid.')}`)
  }

  let pageId: string
  try {
    pageId = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ create_page: string }>('SELECT app.create_page($1,$2,$3)', [
        siteId,
        slug,
        title,
      ])
      const created = rows[0]!.create_page
      const template = String(formData.get('pageTemplate') ?? '').trim()
      if (template || requested.length === 0) {
        const content = await corePageContent(client, template || 'blank', title)
        await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
          created,
          0,
          JSON.stringify(content),
          JSON.stringify({ title, description: '' }),
          'checkpoint',
          'Created from a shared page template',
        ])
        return created
      }

      // WITH ORDINALITY preserves the outline the author arranged. DISTINCT ON
      // is deliberately inside a lateral query: one newest version for each
      // requested definition, not one arbitrary newest row for the whole set.
      const starter = await client.query<PageStarterRow>(
        `SELECT requested.id::text AS section_def_id, version.version, version.slots
           FROM unnest($1::uuid[]) WITH ORDINALITY AS requested(id, position)
           JOIN section_defs definition ON definition.id = requested.id
           JOIN LATERAL (
             SELECT candidate.version, candidate.slots
               FROM section_def_versions candidate
              WHERE candidate.section_def_id = definition.id
              ORDER BY candidate.version DESC
              LIMIT 1
           ) version ON true
          WHERE definition.status = 'active' AND (definition.scope = 'global' OR definition.site_id = $2)
          ORDER BY requested.position`,
        [requested, siteId],
      )
      if (starter.rows.length !== requested.length) {
        throw new Error('One of those starting sections is no longer available. Choose the page structure again.')
      }

      const sourceTemplate = String(formData.get('sourceTemplate') ?? '').trim()
      if (sourceTemplate && sourceTemplate !== 'chapter') throw new Error('Choose a page template from the list.')
      const planned = sourceTemplate ? await corePageContent(client, sourceTemplate, title) : []
      const plannedById = new Map(planned.map(section => [section.section_def_id, section]))
      let seededTitle = planned.some(
        section => requested.includes(section.section_def_id) && section.values.heading === title,
      )
      const content = starter.rows.map(entry => {
        const preset = plannedById.get(entry.section_def_id)
        if (preset && preset.section_def_version !== entry.version)
          throw new Error('A starting section changed. Choose the page structure again.')
        let values: Record<string, unknown> = preset
          ? structuredClone(preset.values)
          : markSampleValues(sectionStartingValues(entry.slots))
        if (!seededTitle && !preset) {
          // A starter should not open as an apparently blank canvas. Put the
          // page name in the first declared text heading anywhere in the
          // arranged outline; a person may legitimately put an image-led
          // section before the hero. Source samples remain editable.
          const heading = entry.slots.find(
            slot => slot.kind === 'text' && /heading|title/i.test(`${slot.id} ${slot.label}`),
          )
          if (heading) {
            values[heading.id] = title
            values = clearSampleField(values, heading.id)
            seededTitle = true
          }
        }
        return {
          section_def_id: entry.section_def_id,
          section_def_version: entry.version,
          values,
          hidden: preset?.hidden ?? false,
          hidden_at: [],
          label: preset?.label ?? '',
        }
      })

      await client.query('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
        created,
        0,
        JSON.stringify(content),
        JSON.stringify({ title, description: '' }),
        'checkpoint',
        'Created with a starting page structure',
      ])
      return created
    })
  } catch (error) {
    const result = toActionResult(error)
    redirect(`/sites/${siteId}?error=${encodeURIComponent(messageFor(result, 'That page could not be created.'))}`)
  }
  revalidatePath(`/sites/${siteId}`)
  redirect(`/pages/${pageId}`)
}

export async function unpublishPage(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const pageId = String(formData.get('pageId') ?? '')
  const expectedRevision = String(formData.get('revision') ?? '')
  try {
    const revision = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client =>
      Number(
        (
          await client.query<{ revision: string }>('SELECT app.unpublish_page($1,$2) AS revision', [
            pageId,
            expectedRevision,
          ])
        ).rows[0]!.revision,
      ),
    )
    revalidatePath(`/pages/${pageId}`)
    revalidatePath('/', 'layout')
    return {
      ok: true,
      revision,
      versionId: null,
      message: 'Page unpublished. Its draft and history are still available in the CMS.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function archivePage(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const pageId = String(formData.get('pageId') ?? '')
  const expectedRevision = String(formData.get('revision') ?? '')
  try {
    const revision = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client =>
      Number(
        (
          await client.query<{ revision: string }>('SELECT app.archive_page($1,$2) AS revision', [
            pageId,
            expectedRevision,
          ])
        ).rows[0]!.revision,
      ),
    )
    // Revalidation includes the now-absent editor in this action response and
    // can show 404 before the client handles the successful receipt. The client
    // performs a full site navigation after acknowledgement, refreshing its
    // dynamic page lists without re-rendering the archived editor here.
    return {
      ok: true,
      revision,
      versionId: null,
      message: 'Page archived. It is off the live site and can be restored from this workspace.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function restoreArchivedPage(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const pageId = String(formData.get('pageId') ?? '')
  const expectedRevision = String(formData.get('revision') ?? '')
  try {
    const revision = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client =>
      Number(
        (
          await client.query<{ revision: string }>('SELECT app.restore_archived_page($1,$2) AS revision', [
            pageId,
            expectedRevision,
          ])
        ).rows[0]!.revision,
      ),
    )
    revalidatePath('/', 'layout')
    return {
      ok: true,
      revision,
      versionId: null,
      message: 'Page restored as a draft. It remains off the live site until you publish it.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}
