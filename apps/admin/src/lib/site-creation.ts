import { createHash } from 'node:crypto'
import { DomainError, normalizeHost } from '@cms/domain'
import { asUser, type Queryable } from '@cms/platform'
import { parsePageMeta, SiteSetup } from '@cms/schema'
import { corePageContent } from './core-pages.ts'
import { starterBodyHtml, starterCollections } from '@cms/seeds/archetypes'

export function stagingBaseDomain(env: Record<string, string | undefined> = process.env): string | null {
  const base =
    env['STAGING_BASE_DOMAIN'] ??
    (env['NODE_ENV'] !== 'production' || env['CMS_LOCAL_TEST_MODE'] === 'true' ? 'staging.localhost' : '')
  const prefix = env['FIREBASE_HOSTING_SITE_PREFIX']
  if (prefix && (base !== 'web.app' || !/^[a-z][a-z0-9-]{1,11}[a-z0-9]$/.test(prefix))) return null
  return base && normalizeHost(base) === base ? base : null
}

export function stagingHostnameFor(slug: string, env: Record<string, string | undefined> = process.env): string | null {
  const base = stagingBaseDomain(env)
  if (!base) return null
  const prefix = env['FIREBASE_HOSTING_SITE_PREFIX']
  const label = prefix ? `${prefix}-${createHash('sha256').update(slug).digest('hex').slice(0, 16)}` : slug
  const host = `${label}.${base}`
  return normalizeHost(host) === host ? host : null
}

/** One transaction: failed content checks cannot leave a partial site behind. */
export async function createSiteFromSetup(
  userId: string,
  requestId: string,
  input: unknown,
): Promise<{ siteId: string; hostname: string }> {
  const setup = SiteSetup.parse(input)
  const hostname = stagingHostnameFor(setup.slug)
  if (!hostname)
    throw new DomainError('invalid_state', 'The staging address has not been configured for this installation.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw new DomainError('invalid_state', 'The site setup request is invalid. Reload the wizard.')
  return asUser({ userId, requestId }, client => createSiteFromSetupInTransaction(client, requestId, setup, hostname))
}

/** The caller owns an identity-scoped transaction; shared with real-role integration tests. */
export async function createSiteFromSetupInTransaction(
  client: Queryable,
  requestId: string,
  setup: SiteSetup,
  hostname: string,
): Promise<{ siteId: string; hostname: string }> {
  const request = (
    await client.query<{ site_id: string; created: boolean }>(
      'SELECT * FROM app.begin_site_setup($1,$2,$3,$4,$5,$6,$7)',
      [
        requestId,
        createHash('sha256').update(JSON.stringify(setup)).digest('hex'),
        setup.slug,
        setup.name,
        setup.kind,
        hostname,
        JSON.stringify(setup.theme),
      ],
    )
  ).rows[0]!
  const siteId = request.site_id
  if (!request.created) {
    const existing = (
      await client.query<{ staging_hostname: string }>('SELECT staging_hostname FROM sites WHERE id=$1', [siteId])
    ).rows[0]!
    return { siteId, hostname: existing.staging_hostname }
  }
  for (const collection of starterCollections(setup)) {
    await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
      siteId,
      collection.slug,
      collection.name,
      collection.readerKey,
      JSON.stringify(collection.model.fields),
      JSON.stringify(collection.model.presentation),
    ])
  }
  const createdPages: {
    id: string
    title: string
    position: number
    menu: boolean
    nested: boolean
    footer: boolean
  }[] = []
  for (const [position, page] of setup.pages.entries()) {
    const pageId = (
      await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [siteId, page.slug, page.title])
    ).rows[0]!.id
    await client.query('UPDATE pages SET sort_index=$1 WHERE id=$2', [position, pageId])
    createdPages.push({
      id: pageId,
      title: page.title,
      position,
      menu: page.menu,
      nested: page.nested,
      footer: page.footer,
    })
    const template =
      page.template ??
      (page.layout !== 'content'
        ? page.layout
        : page.slug === ''
          ? setup.kind === 'event'
            ? 'event-home'
            : 'landing'
          : /visit|travel|hotel/.test(page.slug)
            ? 'visit'
            : /sponsor|exhibit/.test(page.slug)
              ? 'sponsors'
              : 'blank')
    const content = await corePageContent(
      client,
      template,
      page.slug === '' ? setup.name : page.title,
      page.intro,
      page.body ? starterBodyHtml(page.body) : undefined,
    )
    const meta = parsePageMeta({
      title: page.slug === '' ? setup.name : `${page.title} | ${setup.name}`,
      description: page.intro,
    })
    if (!meta.ok) throw new DomainError('invalid_state', meta.problems.map(problem => problem.message).join(' '))
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      pageId,
      0,
      JSON.stringify(content),
      JSON.stringify(meta.meta),
      'checkpoint',
      'Created from a shared page template',
    ])
  }
  // Pages left out of the menu still exist and can be added from Navigation.
  // A nested page opens from the page it sits under; if that page is left out
  // of the menu, the nested one takes its own place at the top.
  type MenuItem = { label: string; target: { type: 'page'; page_id: string }; visible: true; children?: MenuItem[] }
  const ordered = [...createdPages].sort((a, b) => a.position - b.position)
  const menu: MenuItem[] = []
  let parent: { page: (typeof ordered)[number]; item: MenuItem | null } | null = null
  for (const page of ordered) {
    const item: MenuItem = { label: page.title, target: { type: 'page', page_id: page.id }, visible: true }
    if (!page.nested) parent = { page, item: page.menu ? item : null }
    if (!page.menu) continue
    if (page.nested && parent?.item) (parent.item.children ??= []).push(item)
    else menu.push(item)
  }
  const navigation = (
    await client.query<{ revision: string }>('SELECT revision FROM navigations WHERE site_id=$1', [siteId])
  ).rows[0]!
  await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
    siteId,
    navigation.revision,
    JSON.stringify(menu),
    'auto',
  ])
  // The pages chosen for the footer become its links, now that they exist.
  const footerPages = ordered.filter(page => page.footer)
  await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
    siteId,
    1,
    1,
    JSON.stringify({
      ...setup.header,
      brand: { ...setup.header.brand, siteName: setup.header.brand.siteName || setup.name },
    }),
    JSON.stringify({
      ...setup.footer,
      brand: { ...setup.footer.brand, siteName: setup.footer.brand.siteName || setup.name },
      groups: [
        ...(footerPages.length
          ? [
              {
                heading: 'On this site',
                links: footerPages.map(page => ({ label: page.title, target: { type: 'page', page_id: page.id } })),
              },
            ]
          : []),
        ...setup.footer.groups,
      ],
    }),
  ])
  return { siteId, hostname }
}
