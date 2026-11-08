'use server'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { HeaderConfig, FooterConfig, NavTree } from '@cms/schema'
import { currentSession } from '../../../lib/session.ts'
import {
  getPage,
  getSite,
  getGlobalElementsWorkspace,
  getNavigationWorkspace,
  canManageGlobalElements,
} from '../../../lib/queries.ts'
export async function loadPageSiteLook(pageId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to edit the site look.' }
  const page = await getPage(session.principal.userId, pageId)
  if (!page) return { ok: false as const, message: 'This page is unavailable.' }
  const [frame, menu, canManage] = await Promise.all([
    getGlobalElementsWorkspace(session.principal.userId, page.site_id),
    getNavigationWorkspace(session.principal.userId, page.site_id),
    canManageGlobalElements(session.principal.userId, page.site_id),
  ])
  return frame && menu
    ? { ok: true as const, siteId: page.site_id, frame, menu, canManage, superAdmin: session.principal.isSuperAdmin }
    : { ok: false as const, message: 'The site look could not be loaded.' }
}
export async function savePageSiteLook(input: {
  pageId: string
  headerRevision: number
  footerRevision: number
  menuRevision: number
  header: unknown
  footer: unknown
  menu: unknown
  frameChanged: boolean
  menuChanged: boolean
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  try {
    const page = await getPage(session.principal.userId, input.pageId)
    if (!page) return { ok: false as const, message: 'This page is unavailable.' }
    const site = await getSite(session.principal.userId, page.site_id)
    if (!site?.original_design)
      return { ok: false as const, message: 'Use Header & menu or Footer at site level to change these shared areas.' }
    const header = HeaderConfig.parse(input.header)
    const footer = FooterConfig.parse(input.footer)
    const menu = NavTree.parse(input.menu)
    const result = await mapErrors(() =>
      asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
        let headerRevision = input.headerRevision
        let footerRevision = input.footerRevision
        let menuRevision = input.menuRevision
        // Both commands share one transaction: a stale menu rolls back frame edits too.
        if (input.frameChanged) {
          const row = (
            await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
              page.site_id,
              headerRevision,
              footerRevision,
              JSON.stringify(header),
              JSON.stringify(footer),
            ])
          ).rows[0]!
          headerRevision = Number(row.header_revision)
          footerRevision = Number(row.footer_revision)
        }
        if (input.menuChanged)
          menuRevision = Number(
            (
              await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
                page.site_id,
                menuRevision,
                JSON.stringify(menu),
                'manual',
              ])
            ).rows[0]!.revision,
          )
        return { headerRevision, footerRevision, menuRevision }
      }),
    )
    return { ok: true as const, ...result }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError && error.kind === 'stale_revision'
          ? 'Someone else saved this site look. Your edits are still here. Reload to compare before saving again.'
          : error instanceof DomainError
            ? error.message
            : 'The site look could not be saved. Check the fields and try again.',
    }
  }
}

/** The page editor receives scope metadata, never editable frame values. */
export async function loadPageFrameNote(pageId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to open this shared area.' }
  const page = await getPage(session.principal.userId, pageId)
  if (!page) return { ok: false as const, message: 'This page is unavailable.' }
  const frame = await getGlobalElementsWorkspace(session.principal.userId, page.site_id)
  if (!frame)
    return { ok: false as const, message: 'This shared area is unavailable. Return to your page and try again.' }
  return {
    ok: true as const,
    siteId: page.site_id,
    header: frame.pages.filter(page => page.usesHeader !== false).length,
    footer: frame.pages.filter(page => page.usesFooter !== false).length,
    canManage: session.principal.isSuperAdmin || session.principal.memberships.get(page.site_id) === 'site_admin',
  }
}
