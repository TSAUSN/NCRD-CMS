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
test('SSR role journeys expose content editing and reserve publishing/technical controls', async ({ request }) => {
  const db = await connect()
  try {
    const site = (await db.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!
    const page = (
      await db.query('SELECT id FROM pages WHERE site_id=$1 AND archived_at IS NULL ORDER BY created_at LIMIT 1', [
        site.id,
      ])
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
    for (const email of [
      'contributor@example.test',
      'editor@example.test',
      'siteadmin@example.test',
      'root@example.test',
    ]) {
      const editor = await as(request, `/pages/${page.id}?site=draft`, email)
      expect(editor).toContain('Save draft')
      if (email.startsWith('root') || email.startsWith('siteadmin')) {
        expect(editor).toContain('Preview with saved site-look changes')
        expect(editor.match(/<label[^>]*><input[^>]*\/>Preview with saved site-look changes<\/label>/)?.[0]).toContain(
          'checked',
        )
      } else expect(editor).not.toContain('Preview with saved site-look changes')
      if (email.startsWith('contributor')) {
        expect(editor).toContain('Submit for review')
        expect(editor).not.toMatch(/<button[^>]*>\s*Publish\s*<\/button>/)
      } else expect(editor).toMatch(/<button[^>]*>[\s\S]*?Publish/)
      const frame = await as(request, `/sites/${site.id}/global-elements`, email)
      expect(frame).toContain('Header &amp; footer')
      if (email.startsWith('contributor')) {
        expect(frame).toContain('You can inspect the site frame')
        // Server HTML writes the ampersand as an entity.
        expect(frame).not.toMatch(/Publish header &(?:amp;)? footer/)
      } else expect(frame).toMatch(/Publish header &(?:amp;)? footer/)
      const library = await as(request, `/sites/${site.id}/sections`, email)
      expect(library).toContain('Find a section')
      if (!email.startsWith('root') && !email.startsWith('siteadmin')) expect(library).not.toContain('Create a section')
      else expect(library).toContain('Create a section')
      const authoring = await as(request, `/sites/${site.id}/sections/new`, email)
      if (email.startsWith('contributor') || email.startsWith('editor'))
        expect(authoring).toContain('You cannot create sections on this site')
      else expect(authoring).not.toContain('You cannot create sections on this site')
      for (const suffix of ['content', 'media', 'navigation', 'design']) {
        const response = await request.get(`/sites/${site.id}/${suffix}`, { headers: { cookie: cookie(email) } })
        expect(response.status(), `${email}: ${suffix}`).toBe(200)
      }
      const frames = await request.get(`/sites/${site.id}/sections/frames`, { headers: { cookie: cookie(email) } })
      expect(frames.status()).toBe(email.startsWith('root') ? 200 : 404)
    }
    for (const path of [
      `/pages/${page.id}`,
      `/sites/${site.id}/content`,
      `/sites/${site.id}/global-elements`,
      `/sites/${site.id}/sections`,
    ]) {
      expect((await request.get(path)).status()).toBe(404)
      expect((await request.get(path, { headers: { cookie: cookie('stranger@example.test') } })).status()).toBe(404)
    }
  } finally {
    await db.end()
  }
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
