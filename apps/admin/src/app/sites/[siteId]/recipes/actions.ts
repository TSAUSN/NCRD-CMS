'use server'

import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentSession } from '../../../../lib/session.ts'

export type RecipeActionState = { ok: boolean; message: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function failure(error: unknown): RecipeActionState {
  const code = (error as { code?: string }).code
  if (code === 'CMS01')
    return {
      ok: false,
      message:
        'This template or page changed. Reload the workspace and review the latest saved version before trying again.',
    }
  if (code === 'CMS02' || code === 'CMS03')
    return { ok: false, message: 'That template, page or action is not available with your access.' }
  if (code === 'CMS04') return { ok: false, message: (error as Error).message }
  if (code === '23505') return { ok: false, message: 'A page already uses that address. Choose another address.' }
  return { ok: false, message: 'The template could not be saved. Check the selected page and try again.' }
}
export async function changeRecipe(_previous: RecipeActionState, form: FormData): Promise<RecipeActionState> {
  const session = await currentSession()
  if (!session) redirect('/sign-in')
  const siteId = String(form.get('siteId') ?? '')
  const recipeId = String(form.get('recipeId') ?? '')
  const revision = String(form.get('revision') ?? '')
  const command = String(form.get('command') ?? '')
  if (!uuid.test(siteId) || (recipeId && !uuid.test(recipeId)) || !/^\d+$/.test(revision)) {
    return { ok: false, message: 'Reload the template workspace before saving.' }
  }
  let pageId: string | null = null
  try {
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      // The submitted site determines navigation only; commands independently
      // authorize their records. This extra match prevents misleading redirects.
      if (
        recipeId &&
        !(
          await client.query("SELECT id FROM page_recipes WHERE id=$1 AND (site_id=$2 OR scope='global')", [
            recipeId,
            siteId,
          ])
        ).rowCount
      ) {
        throw Object.assign(new Error('Unavailable template'), { code: 'CMS03' })
      }
      if (command === 'save') {
        const source = String(form.get('sourceVersion') ?? '')
        const selection: unknown = JSON.parse(String(form.get('selection') ?? 'null'))
        if (!uuid.test(source) || !Array.isArray(selection)) throw new Error('Invalid selection')
        await client.query('SELECT app.save_page_recipe($1,$2,$3,$4,$5,$6)', [
          siteId,
          recipeId || null,
          revision,
          String(form.get('name') ?? ''),
          source,
          JSON.stringify(selection),
        ])
      } else if (command === 'share') {
        await client.query('SELECT app.share_page_recipe($1,$2,$3)', [
          recipeId,
          revision,
          String(form.get('name') ?? ''),
        ])
      } else if (command === 'rename' || command === 'retire' || command === 'restore') {
        await client.query('SELECT app.manage_page_recipe($1,$2,$3,$4)', [
          recipeId,
          revision,
          String(form.get('name') ?? ''),
          command === 'retire',
        ])
      } else if (command === 'use') {
        const target = String(form.get('pageId') ?? '')
        const targetSite = String(form.get('targetSite') ?? siteId)
        const bindings: unknown = JSON.parse(String(form.get('bindings') ?? '{}'))
        const pageRevision = String(form.get('pageRevision') ?? '')
        if (
          !uuid.test(targetSite) ||
          (target && (!uuid.test(target) || !/^\d+$/.test(pageRevision))) ||
          (target && form.get('savedOnlyConfirmed') !== 'on')
        )
          throw new Error('Review the saved page first')
        pageId = (
          await client.query<{ id: string }>('SELECT app.use_mapped_page_recipe($1,$2,$3,$4,$5,$6,$7,$8) AS id', [
            recipeId,
            revision,
            targetSite,
            JSON.stringify(bindings),
            target || null,
            target ? pageRevision : null,
            String(form.get('title') ?? ''),
            String(form.get('slug') ?? ''),
          ])
        ).rows[0]!.id
      } else throw new Error('Unknown template command')
    })
  } catch (error) {
    return failure(error)
  }
  revalidatePath(`/sites/${siteId}/recipes`)
  revalidatePath(`/sites/${siteId}`)
  if (pageId) {
    revalidatePath(`/pages/${pageId}`)
    redirect(`/pages/${pageId}`)
  }
  return {
    ok: true,
    message:
      command === 'retire'
        ? 'Template retired. Existing pages are unchanged.'
        : 'Template saved. Existing pages are unchanged.',
  }
}
