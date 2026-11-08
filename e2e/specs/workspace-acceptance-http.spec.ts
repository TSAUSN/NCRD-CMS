// Real built-app requests and server-rendered controls, not browser interaction.
import { createHmac } from 'node:crypto'
import { Client } from 'pg'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { e2eTarget } from '../test-target.ts'
function cookie(email: string) {
  const payload = Buffer.from(JSON.stringify({ subject: `local|${email}`, email })).toString('base64url')
  return `cms_session=${payload}.${createHmac('sha256', 'e2e-secret-value-not-used-in-production').update(payload).digest('base64url')}`
}
// Remove RSC payloads before assertions: unused boundaries and serialized props
// do not count as controls presented to an author in the server document.
function documentMarkup(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}
async function connect() {
  const { database, host, port } = e2eTarget()
  const db = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await db.connect()
  return db
}
async function as(request: APIRequestContext, path: string, email: string) {
  const response = await request.get(path, { headers: { cookie: cookie(email) } })
  expect(response.status(), path).toBe(200)
  return documentMarkup(await response.text())
}
async function roleFixture() {
  const db = await connect()
  try {
    const site = (await db.query<{ id: string }>("SELECT id FROM sites WHERE slug='demo'")).rows[0]!
    const page = (
      await db.query<{ id: string }>(
        'SELECT id FROM pages WHERE site_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1',
        [site.id],
      )
    ).rows[0]!
    const root = (await db.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await db.query('BEGIN')
    await db.query("SELECT set_config('app.user_id',$1,true)", [root])
    const siteAdmin = (
      await db.query('SELECT app.provision_user($1,$2) AS id', [
        'siteadmin@example.test',
        'Synthetic Site Administrator',
      ])
    ).rows[0]!.id
    await db.query('SELECT app.set_site_membership($1,$2,$3)', [siteAdmin, site.id, 'site_admin'])
    await db.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|siteadmin@example.test', siteAdmin])
    await db.query('COMMIT')
    return { siteId: site.id, pageId: page.id }
  } finally {
    await db.end()
  }
}

const roles = [
  { kind: 'contributor', email: 'contributor@example.test', label: 'Contributor' },
  { kind: 'editor', email: 'editor@example.test', label: 'Editor' },
  { kind: 'site_admin', email: 'siteadmin@example.test', label: 'Site admin' },
  { kind: 'super_admin', email: 'root@example.test', label: 'Super admin' },
] as const

test.describe('SSR role journeys', () => {
  let fixture: Awaited<ReturnType<typeof roleFixture>>
  test.beforeAll(async () => {
    fixture = await roleFixture()
  })

  for (const { kind, email, label } of roles) {
    test(`${label} sees permitted editorial and technical controls`, async ({ request }) => {
      const { siteId, pageId } = fixture
      const isContributor = kind === 'contributor'
      const isRoot = kind === 'super_admin'
      const canCreateSections = isRoot || kind === 'site_admin'
      const canPreviewSiteLook = isRoot || kind === 'site_admin'
      const editor = await as(request, `/pages/${pageId}?site=draft`, email)
      expect(editor).toContain('Save draft')
      if (canPreviewSiteLook) {
        expect(editor).toContain('Preview with saved site-look changes')
        expect(editor.match(/<label[^>]*><input[^>]*\/>Preview with saved site-look changes<\/label>/)?.[0]).toContain(
          'checked',
        )
      } else expect(editor).not.toContain('Preview with saved site-look changes')
      if (isContributor) {
        expect(editor).toContain('Submit for review')
        expect(editor).not.toMatch(/<button[^>]*>\s*Publish\s*<\/button>/)
      } else expect(editor).toMatch(/<button[^>]*>[\s\S]*?Publish/)
      const frame = await as(request, `/sites/${siteId}/global-elements`, email)
      expect(frame).toContain('Header &amp; footer')
      if (isContributor) {
        expect(frame).toContain('You can inspect the site frame')
        // Server HTML writes the ampersand as an entity.
        expect(frame).not.toMatch(/Publish header &(?:amp;)? footer/)
      } else expect(frame).toMatch(/Publish header &(?:amp;)? footer/)
      const library = await as(request, `/sites/${siteId}/sections`, email)
      expect(library).toContain('Find a section')
      if (!canCreateSections) expect(library).not.toContain('Create a section')
      else expect(library).toContain('Create a section')
      const authoring = await as(request, `/sites/${siteId}/sections/new`, email)
      if (!canCreateSections) expect(authoring).toContain('You cannot create sections on this site')
      else expect(authoring).not.toContain('You cannot create sections on this site')
      for (const suffix of ['content', 'media', 'navigation', 'design']) {
        const response = await request.get(`/sites/${siteId}/${suffix}`, { headers: { cookie: cookie(email) } })
        expect(response.status(), `${email}: ${suffix}`).toBe(200)
      }
      const frames = await request.get(`/sites/${siteId}/sections/frames`, { headers: { cookie: cookie(email) } })
      expect(frames.status()).toBe(isRoot ? 200 : 404)
    })
  }

  test('anonymous and unrelated users cannot open protected editorial routes', async ({ request }) => {
    const { siteId, pageId } = fixture
    for (const path of [
      `/pages/${pageId}`,
      `/sites/${siteId}/content`,
      `/sites/${siteId}/global-elements`,
      `/sites/${siteId}/sections`,
    ]) {
      expect((await request.get(path)).status()).toBe(404)
      expect((await request.get(path, { headers: { cookie: cookie('stranger@example.test') } })).status()).toBe(404)
    }
  })
})

test('unsaved frame HTTP preview validates input and never changes draft or live pointers', async ({ request }) => {
  const db = await connect()
  try {
    const site = (await db.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!
    const page = (
      await db.query(
        'SELECT draft_version_id FROM pages WHERE site_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1',
        [site.id],
      )
    ).rows[0]!
    const heads = (
      await db.query(
        'SELECT g.kind,g.revision,g.draft_version_id,g.published_version_id,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
        [site.id],
      )
    ).rows
    const header = heads.find(row => row.kind === 'header')!.content
    const footer = heads.find(row => row.kind === 'footer')!.content
    const body = {
      versionId: page.draft_version_id,
      header: { ...header, brand: { ...header.brand, siteName: 'Unsaved cloud walkthrough brand' } },
      footer,
    }
    const endpoint = `/api/sites/${site.id}/global-elements/preview`
    const headers = { cookie: cookie('editor@example.test') }
    const good = await request.post(endpoint, { headers, data: body })
    expect(good.status()).toBe(200)
    expect(await good.text()).toContain('Unsaved cloud walkthrough brand')
    expect(good.headers()['content-security-policy']).toContain("script-src 'none'")
    expect(good.headers()['cache-control']).toContain('no-store')
    for (const data of [
      { ...body, versionId: 'malformed' },
      { ...body, header: {} },
      { ...body, footer: null },
    ]) {
      expect((await request.post(endpoint, { headers, data })).status()).toBe(400)
    }
    expect(
      (
        await request.post(endpoint, { headers, data: { ...body, versionId: '99999999-9999-4999-8999-999999999999' } })
      ).status(),
    ).toBe(404)
    expect((await request.post(endpoint, { data: body })).status()).toBe(404)
    expect(
      (await request.post(endpoint, { headers: { cookie: cookie('stranger@example.test') }, data: body })).status(),
    ).toBe(404)
    expect(
      (
        await db.query(
          'SELECT g.kind,g.revision,g.draft_version_id,g.published_version_id,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
          [site.id],
        )
      ).rows,
    ).toEqual(heads)
  } finally {
    await db.end()
  }
})
