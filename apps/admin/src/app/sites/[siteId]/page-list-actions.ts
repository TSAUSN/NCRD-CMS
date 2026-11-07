'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser, type Queryable } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { FooterConfig, HeaderConfig, NavTree, NavUrl, PageContent } from '@cms/schema'
import { currentSession } from '../../../lib/session.ts'
import { saveHeaderMenuDraft } from '../../../lib/header-menu.ts'
import { saveFooterDraft } from '../../../lib/footer-draft.ts'
import { pageMenuSwitch, reorderPageMenu, footerPageSwitch } from '../../../lib/page-list-links.ts'
import { readPageListControls, type PageListControls } from '../../../lib/page-list-workspace.ts'
import { corePageContent } from '../../../lib/core-pages.ts'
async function native(client: Queryable, siteId: string, admin = true) {
  const row = (
    await client.query(
      "SELECT app.can_administer_site($1) AS admin,app.can_publish($1) AS edit,EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id IN(h.draft_version_id,h.published_version_id) WHERE h.site_id=$1 AND v.bundle ? 'original') AS imported",
      [siteId],
    )
  ).rows[0]
  if (!row || row.imported || !(admin ? row.admin : row.edit))
    throw new DomainError(
      'not_authorized',
      admin ? 'A Site admin changes the menu and footer.' : 'This page cannot be created here.',
    )
  return row
}
async function frames(client: Queryable, siteId: string) {
  const rows = (
    await client.query(
      'SELECT g.kind,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
      [siteId],
    )
  ).rows
  return {
    header: HeaderConfig.parse(rows.find(row => row.kind === 'header')?.content),
    footer: FooterConfig.parse(rows.find(row => row.kind === 'footer')?.content),
  }
}
function revisions(
  a: PageListControls,
  b: Pick<PageListControls, 'headerRevision' | 'footerRevision' | 'menuRevision'>,
) {
  if (
    a.headerRevision !== b.headerRevision ||
    a.footerRevision !== b.footerRevision ||
    a.menuRevision !== b.menuRevision
  )
    throw new DomainError(
      'stale_revision',
      'Someone else saved the menu or footer. Reload to see their changes before trying again.',
    )
}
function refresh(siteId: string) {
  for (const area of ['pages', 'header', 'footer', 'publishing']) revalidatePath('/sites/' + siteId + '/' + area)
}
export async function changePageList(input: {
  siteId: string
  pageId: string
  kind: 'menu' | 'footer' | 'move'
  on?: boolean
  beforeId?: string
  controls: Pick<PageListControls, 'headerRevision' | 'footerRevision' | 'menuRevision' | 'orderToken'>
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  try {
    const controls = await mapErrors(() =>
      asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
        await native(client, input.siteId)
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['page-order:' + input.siteId])
        const current = await readPageListControls(client, input.siteId)
        revisions(current, input.controls)
        const page = (
          await client.query<{ id: string; title: string; slug: string }>(
            'SELECT id,title,slug FROM pages WHERE id=$1 AND site_id=$2 AND archived_at IS NULL',
            [input.pageId, input.siteId],
          )
        ).rows[0]
        if (!page || !current.order.includes(page.id))
          throw new DomainError('not_authorized', 'Choose a page on this site. Stories are edited in Stories.')
        const frame = await frames(client, input.siteId)
        if (input.kind === 'footer') {
          if (typeof input.on !== 'boolean')
            throw new DomainError('invalid_state', 'Choose whether the page is in the footer.')
          await saveFooterDraft(client, {
            siteId: input.siteId,
            ...current,
            footer: footerPageSwitch(frame.footer, page, input.on),
          })
        } else {
          let menu = current.menu
          if (input.kind === 'menu') {
            if (typeof input.on !== 'boolean')
              throw new DomainError('invalid_state', 'Choose whether the page is in the menu.')
            const published =
              (
                await client.query(
                  'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.published_version_id WHERE n.site_id=$1',
                  [input.siteId],
                )
              ).rows[0]?.tree ?? []
            menu = pageMenuSwitch(menu, NavTree.parse(published), page, input.on)
          } else if (input.kind === 'move') {
            if (current.orderToken !== input.controls.orderToken)
              throw new DomainError('stale_revision', 'The page order changed. Reload before moving this page.')
            if (!input.beforeId || !current.order.includes(input.beforeId) || input.beforeId === page.id) return current
            const order = current.order.filter(id => id !== page.id)
            order.splice(order.indexOf(input.beforeId), 0, page.id)
            menu = reorderPageMenu(menu, order)
            await client.query(
              'UPDATE pages p SET sort_index=ordered.position::int FROM unnest($2::uuid[]) WITH ORDINALITY ordered(id,position) WHERE p.site_id=$1 AND p.id=ordered.id',
              [input.siteId, order],
            )
          } else throw new DomainError('invalid_state', 'Choose a menu, footer or page-order change.')
          await saveHeaderMenuDraft(client, {
            siteId: input.siteId,
            ...current,
            header: frame.header,
            menu,
            mode: 'manual',
          })
        }
        return readPageListControls(client, input.siteId)
      }),
    )
    refresh(input.siteId)
    return { ok: true as const, controls, message: 'Draft saved. Visitors still see the published menu and footer.' }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The save could not be confirmed. Reload to compare before trying again.',
    }
  }
}
export async function createNativePage(input: {
  siteId: string
  title: string
  address: string
  description: string
  start: 'blank' | 'design' | 'copy' | 'website'
  template?: string
  sourceId?: string
  sourceRevision?: string
  url?: string
  inMenu: boolean
  parentId?: string | null
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before creating a draft.' }
  if (
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    input.title.trim().length > 90 ||
    typeof input.description !== 'string' ||
    input.description.length > 155
  )
    return { ok: false as const, message: 'Add a title of up to 90 characters and a description of up to 155.' }
  if (
    input.start !== 'website' &&
    (!input.address || input.address.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.address))
  )
    return { ok: false as const, message: 'Use lowercase letters, numbers and hyphens in the page address.' }
  if (input.start === 'website' && input.title.trim().length > 80)
    return {
      ok: false as const,
      message: 'A menu link name can be up to 80 characters. Shorten this title before adding it.',
    }
  if (input.start === 'website' && (!input.url?.startsWith('https://') || !NavUrl.safeParse(input.url).success))
    return { ok: false as const, message: 'Add an https website address without spaces or sign-in details.' }
  try {
    const result = await mapErrors(() =>
      asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
        const allowed = await native(client, input.siteId, false)
        if ((input.start === 'website' || input.inMenu) && !allowed.admin)
          throw new DomainError('not_authorized', 'A Site admin adds links to the site menu.')
        const controls = await readPageListControls(client, input.siteId),
          frame = await frames(client, input.siteId)
        if (input.start === 'website') {
          const menu = NavTree.parse([
            ...controls.menu,
            { label: input.title.trim(), target: { type: 'url', url: input.url }, visible: true },
          ])
          await saveHeaderMenuDraft(client, {
            siteId: input.siteId,
            ...controls,
            header: frame.header,
            menu,
            mode: 'manual',
          })
          return {
            pageId: null,
            message: 'Website link added to the menu draft. There is no page to edit. Review it in Publish.',
          }
        }
        let pageId: string,
          content: unknown,
          meta: Record<string, unknown>,
          revision: string | number = 0
        if (input.start === 'copy') {
          const source = (
            await client.query(
              'SELECT id,revision::text FROM pages WHERE id=$1 AND site_id=$2 AND archived_at IS NULL',
              [input.sourceId, input.siteId],
            )
          ).rows[0]
          if (!source || !controls.order.includes(source.id))
            throw new DomainError('not_authorized', 'Choose a page on this site.')
          if (source.revision !== input.sourceRevision)
            throw new DomainError('stale_revision', 'The page to copy changed. Reload before making the copy.')
          const copy = (
            await client.query('SELECT * FROM app.duplicate_page($1,$2)', [source.id, input.sourceRevision])
          ).rows[0]
          pageId = copy.page_id
          const saved = (
            await client.query(
              'SELECT p.revision,v.content,v.meta,p.parent_page_id,n.revision AS menu_revision FROM pages p JOIN page_versions v ON v.id=p.draft_version_id JOIN navigations n ON n.site_id=p.site_id WHERE p.id=$1',
              [pageId],
            )
          ).rows[0]
          const changed = (
            await client.query('SELECT * FROM app.save_page_details($1,$2,$3,$4,$5,false,$6)', [
              pageId,
              saved.revision,
              input.title.trim(),
              input.address,
              saved.parent_page_id,
              saved.menu_revision,
            ])
          ).rows[0]
          revision = changed.revision
          content = PageContent.parse(saved.content)
          meta = { ...saved.meta, title: input.title.trim(), description: input.description }
        } else {
          if (!['blank', 'design'].includes(input.start))
            throw new DomainError('invalid_state', 'Choose how the page starts.')
          pageId = (
            await client.query('SELECT app.create_page($1,$2,$3) AS id', [
              input.siteId,
              input.address,
              input.title.trim(),
            ])
          ).rows[0].id
          content = await corePageContent(
            client,
            input.start === 'blank' ? 'blank' : (input.template ?? 'landing'),
            input.title.trim(),
          )
          meta = { title: input.title.trim(), description: input.description }
        }
        await client.query(
          "SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','Created a private page draft')",
          [pageId, revision, JSON.stringify(content), JSON.stringify(meta)],
        )
        if (input.parentId !== undefined) {
          // Existing command retains tenant, actor, cycle and revision checks.
          await client.query('SELECT app.set_page_parent($1,(SELECT revision FROM pages WHERE id=$1),$2)', [
            pageId,
            input.parentId,
          ])
        }
        if (allowed.admin) {
          const latest = await readPageListControls(client, input.siteId)
          await saveHeaderMenuDraft(client, {
            siteId: input.siteId,
            ...latest,
            header: frame.header,
            menu: pageMenuSwitch(
              latest.menu,
              [],
              { id: pageId, title: input.title.trim(), slug: input.address },
              input.inMenu,
            ),
            mode: 'manual',
          })
        }
        return { pageId, message: 'Page created as a private draft.' }
      }),
    )
    refresh(input.siteId)
    return { ok: true as const, ...result }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The draft could not be confirmed. Check Pages before trying again.',
    }
  }
}
