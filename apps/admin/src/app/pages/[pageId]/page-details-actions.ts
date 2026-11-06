'use server'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { NavTree } from '@cms/schema'
import { currentSession } from '../../../lib/session.ts'
import { savePageDetails, pageInMenu, pageMenuLocations, type PageDetailsInput } from '../../../lib/page-details.ts'
export async function loadPageDetails(pageId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to open Page settings.' }
  return asUser({ userId: session.principal.userId }, async client => {
    const page = (
      await client.query<{
        site_id: string
        title: string
        slug: string
        parent_page_id: string | null
        can_manage: boolean
        can_manage_menu: boolean
        original_design: boolean
      }>(
        `SELECT p.site_id,p.title,p.slug,p.parent_page_id,app.can_publish(p.site_id) AS can_manage,app.can_administer_site(p.site_id) AS can_manage_menu,EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=p.site_id AND v.bundle ? 'original') AS original_design FROM pages p WHERE p.id=$1 AND p.archived_at IS NULL`,
        [pageId],
      )
    ).rows[0]
    if (!page) return { ok: false as const, message: 'This page is unavailable.' }
    const nav = (
      await client.query<{ revision: string; tree: unknown }>(
        `SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1`,
        [page.site_id],
      )
    ).rows[0]!
    const pages = (
      await client.query<{ id: string; title: string; slug: string }>(
        `WITH RECURSIVE children AS (SELECT id FROM pages WHERE id=$1 UNION SELECT p.id FROM pages p JOIN children c ON p.parent_page_id=c.id) SELECT id,title,slug FROM pages WHERE site_id=$2 AND archived_at IS NULL AND id NOT IN(SELECT id FROM children) ORDER BY title`,
        [pageId, page.site_id],
      )
    ).rows
    const reserved = (
      await client.query<{ address: string }>(
        `SELECT slug AS address FROM pages WHERE site_id=$1 AND id<>$2 UNION SELECT trim(leading '/' FROM path) FROM published_routes WHERE site_id=$1 AND page_id<>$2`,
        [page.site_id, pageId],
      )
    ).rows.map(row => row.address)
    return {
      ok: true as const,
      siteId: page.site_id,
      canManageMenu: page.can_manage_menu,
      reservedAddresses: reserved,
      title: page.title,
      address: page.slug,
      parentId: page.parent_page_id,
      inMenu: pageInMenu(NavTree.parse(nav?.tree ?? []), pageId),
      menuReadOnly: !page.original_design,
      menuLocations: pageMenuLocations(NavTree.parse(nav?.tree ?? []), pageId),
      menuRevision: Number(nav?.revision ?? 0),
      canManage: page.can_manage,
      pages,
    }
  })
}
export async function savePageDetailsAction(input: PageDetailsInput, expectedRevision: number) {
  const session = await currentSession()
  if (!session) return { ok: false as const, kind: 'error' as const, message: 'Sign in before saving.' }
  const title = String(input.title).trim(),
    address = String(input.address).trim().toLowerCase()
  if (
    !title ||
    title.length > 200 ||
    address.length > 160 ||
    (address !== '' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(address)) ||
    (input.inMenu !== null && typeof input.inMenu !== 'boolean')
  )
    return {
      ok: false as const,
      kind: 'error' as const,
      message: 'Enter a page name and an address with lowercase letters, numbers and hyphens.',
    }
  try {
    const result = await mapErrors(() =>
      asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
        savePageDetails(client, { ...input, title, address }, expectedRevision),
      ),
    )
    return {
      ok: true as const,
      ...result,
      message:
        input.inMenu === null
          ? 'Page details saved. Publish the page to change its live name or address.'
          : 'Page details saved. Publish the page to change its live name or address; review menu changes in Publish.',
    }
  } catch (error) {
    return error instanceof DomainError && error.kind === 'stale_revision'
      ? {
          ok: false as const,
          kind: 'conflict' as const,
          currentRevision: error.currentRevision,
          message: error.message,
        }
      : {
          ok: false as const,
          kind: 'error' as const,
          message:
            (error as { code?: string }).code === '23505' ||
            /duplicate key|another.*address/i.test(error instanceof Error ? error.message : '')
              ? 'Another page already uses that address.'
              : error instanceof DomainError
                ? error.message
                : 'Page details could not be saved. Reopen this drawer and try again.',
        }
  }
}
