'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { FooterConfig, HeaderConfig, NavTree, ThemeTokens } from '@cms/schema'
import { ActionResult, GlobalElementsActionResult, requireSession, toActionResult } from '../../lib/action-result.ts'

export async function saveNavigationDraft(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedRevision = Number(formData.get('revision'))
  const mode = String(formData.get('mode') ?? '')
  let raw: unknown
  try {
    raw = JSON.parse(String(formData.get('tree') ?? ''))
  } catch {
    return { ok: false, kind: 'error', message: 'The navigation outline is not valid JSON.' }
  }
  const parsed = NavTree.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      kind: 'error',
      message: parsed.error.issues[0]?.message ?? 'The navigation outline is invalid.',
    }
  }
  if (mode !== 'auto' && mode !== 'manual') {
    return { ok: false, kind: 'error', message: 'Choose automatic or manual page syncing.' }
  }
  try {
    const saved = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.save_navigation_draft($1,$2,$3,$4)',
        [siteId, expectedRevision, JSON.stringify(parsed.data), mode],
      )
      return { versionId: rows[0]!.version_id, revision: Number(rows[0]!.revision) }
    })
    revalidatePath(`/sites/${siteId}/navigation`)
    return {
      ok: true,
      revision: saved.revision,
      versionId: saved.versionId,
      message: 'Navigation draft saved. Visitors still see the published menu.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function publishNavigation(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedRevision = Number(formData.get('revision'))
  try {
    const published = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.publish_navigation($1,$2)',
        [siteId, expectedRevision],
      )
      return { versionId: rows[0]!.version_id, revision: Number(rows[0]!.revision) }
    })
    revalidatePath(`/sites/${siteId}/navigation`)
    revalidatePath('/', 'layout')
    return {
      ok: true,
      revision: published.revision,
      versionId: published.versionId,
      message: 'Navigation published. The live site now uses this menu.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function saveThemeDraft(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedRevision = Number(formData.get('revision'))
  let raw: unknown
  try {
    raw = JSON.parse(String(formData.get('tokens') ?? ''))
  } catch {
    return { ok: false, kind: 'error', message: 'The design settings are not valid JSON.' }
  }
  const parsed = ThemeTokens.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      kind: 'error',
      message: parsed.error.issues[0]?.message ?? 'The design settings are invalid.',
    }
  }
  try {
    const saved = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.save_theme_draft($1,$2,$3)',
        [siteId, expectedRevision, JSON.stringify(parsed.data)],
      )
      return { versionId: rows[0]!.version_id, revision: Number(rows[0]!.revision) }
    })
    revalidatePath(`/sites/${siteId}/design`)
    return {
      ok: true,
      revision: saved.revision,
      versionId: saved.versionId,
      message: 'Design draft saved. Visitors still see the published design.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function publishTheme(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedRevision = Number(formData.get('revision'))
  try {
    const published = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.publish_theme($1,$2)',
        [siteId, expectedRevision],
      )
      return { versionId: rows[0]!.version_id, revision: Number(rows[0]!.revision) }
    })
    revalidatePath(`/sites/${siteId}/design`)
    revalidatePath('/', 'layout')
    return {
      ok: true,
      revision: published.revision,
      versionId: published.versionId,
      message: 'Design published. The live site now uses these styles.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function revertThemeToLive(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedRevision = Number(formData.get('revision'))
  try {
    const reverted = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.revert_theme_to_live($1,$2)',
        [siteId, expectedRevision],
      )
      return { versionId: rows[0]!.version_id, revision: Number(rows[0]!.revision) }
    })
    revalidatePath(`/sites/${siteId}/design`)
    return {
      ok: true,
      revision: reverted.revision,
      versionId: reverted.versionId,
      message: 'The draft now matches the live design. Published pages were not changed.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

function parseGlobalElementsDraft(
  formData: FormData,
): { header: HeaderConfig; footer: FooterConfig } | { error: GlobalElementsActionResult } {
  let headerValue: unknown
  let footerValue: unknown
  try {
    headerValue = JSON.parse(String(formData.get('header') ?? ''))
    footerValue = JSON.parse(String(formData.get('footer') ?? ''))
  } catch {
    return { error: { ok: false, kind: 'error', message: 'The header or footer settings are not valid JSON.' } }
  }
  const header = HeaderConfig.safeParse(headerValue)
  const footer = FooterConfig.safeParse(footerValue)
  if (!header.success) {
    return {
      error: {
        ok: false,
        kind: 'error',
        message: header.error.issues[0]?.message ?? 'The header settings are invalid.',
      },
    }
  }
  if (!footer.success) {
    return {
      error: {
        ok: false,
        kind: 'error',
        message: footer.error.issues[0]?.message ?? 'The footer settings are invalid.',
      },
    }
  }
  return { header: header.data, footer: footer.data }
}

type GlobalElementsWriteRow = {
  header_version_id: string
  header_revision: string
  footer_version_id: string
  footer_revision: string
}

function globalElementsSuccess(row: GlobalElementsWriteRow, message: string): GlobalElementsActionResult {
  return {
    ok: true,
    headerRevision: Number(row.header_revision),
    footerRevision: Number(row.footer_revision),
    headerVersionId: row.header_version_id,
    footerVersionId: row.footer_version_id,
    message,
  }
}

function globalElementsError(error: unknown): Exclude<ActionResult, { ok: true }> {
  const result = toActionResult(error)
  return result.kind === 'conflict'
    ? {
        ...result,
        message:
          'Someone else saved this site frame while you were editing. Your work is still here — reload to compare it before saving again.',
      }
    : result
}

/** Save the header and footer as one intention; the database commits both or neither. */
export async function saveGlobalElementsDraft(formData: FormData): Promise<GlobalElementsActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedHeaderRevision = Number(formData.get('headerRevision'))
  const expectedFooterRevision = Number(formData.get('footerRevision'))
  const parsed = parseGlobalElementsDraft(formData)
  if ('error' in parsed) return parsed.error
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<GlobalElementsWriteRow>('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
            siteId,
            expectedHeaderRevision,
            expectedFooterRevision,
            JSON.stringify(parsed.header),
            JSON.stringify(parsed.footer),
          ])
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/global-elements`)
    return globalElementsSuccess(row, 'Header and footer draft saved. Visitors still see the published version.')
  } catch (error) {
    return globalElementsError(error)
  }
}

/** Publish both site-wide elements atomically so the live frame never mixes revisions. */
export async function publishGlobalElements(formData: FormData): Promise<GlobalElementsActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedHeaderRevision = Number(formData.get('headerRevision'))
  const expectedFooterRevision = Number(formData.get('footerRevision'))
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<GlobalElementsWriteRow>('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
            siteId,
            expectedHeaderRevision,
            expectedFooterRevision,
          ])
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/global-elements`)
    revalidatePath('/', 'layout')
    return globalElementsSuccess(row, 'Header and footer published together across the live site.')
  } catch (error) {
    return globalElementsError(error)
  }
}

/** Copy both live artifacts into a fresh draft without changing the public site. */
export async function revertGlobalElementsToLive(formData: FormData): Promise<GlobalElementsActionResult> {
  const session = await requireSession()
  const siteId = String(formData.get('siteId') ?? '')
  const expectedHeaderRevision = Number(formData.get('headerRevision'))
  const expectedFooterRevision = Number(formData.get('footerRevision'))
  try {
    const row = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<GlobalElementsWriteRow>('SELECT * FROM app.revert_global_elements_to_live($1,$2,$3)', [
            siteId,
            expectedHeaderRevision,
            expectedFooterRevision,
          ])
        ).rows[0]!,
    )
    revalidatePath(`/sites/${siteId}/global-elements`)
    return globalElementsSuccess(
      row,
      'The draft now matches the live header and footer. The public site was not changed.',
    )
  } catch (error) {
    return globalElementsError(error)
  }
}
