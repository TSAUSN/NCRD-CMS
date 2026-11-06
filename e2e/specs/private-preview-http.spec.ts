// HTTP acceptance complements browser coverage; it does not assert interaction,
// layout or keyboard behavior. It runs against the real built applications,
// authentication adapter, PostgreSQL roles and renderers without launching a browser.
import { createHmac } from 'node:crypto'
import { Client } from 'pg'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { e2eTarget } from '../test-target.ts'

function localSession(email: string) {
  const payload = Buffer.from(JSON.stringify({ subject: `local|${email}`, email })).toString('base64url')
  const signature = createHmac('sha256', 'e2e-secret-value-not-used-in-production').update(payload).digest('base64url')
  return `cms_session=${payload}.${signature}`
}

async function getAs(request: APIRequestContext, url: string, email = 'root@example.test') {
  return request.get(url, { headers: { cookie: localSession(email) } })
}

test('HTTP previews compose saved appearance privately and enforce tenant access', async ({ request }) => {
  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  let siteId = '',
    rootId = ''
  try {
    rootId = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const definitionId = (await client.query("SELECT id FROM section_defs WHERE slug='hero' AND scope='global'"))
      .rows[0]!.id
    const demoSite = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    siteId = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `http-preview-${Date.now()}`,
        'HTTP preview fixture',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    // Compare two deliberately distinct saved and published appearances.
    await client.query('SELECT app.publish_theme($1,1)', [siteId])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [siteId])
    await client.query('SELECT app.publish_navigation($1,1)', [siteId])
    const pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, '', 'HTTP preview page']))
      .rows[0]!.id
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        pageId,
        JSON.stringify([
          { section_def_id: definitionId, section_def_version: 1, values: { heading: 'HTTP content stays private' } },
        ]),
        '{}',
      ])
    ).rows[0]!
    const heads = (
      await client.query(
        'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [siteId],
      )
    ).rows
    const header = heads.find(row => row.kind === 'header')!,
      footer = heads.find(row => row.kind === 'footer')!
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      siteId,
      header.revision,
      footer.revision,
      JSON.stringify({ ...header.content, brand: { ...header.content.brand, siteName: 'HTTP saved brand' } }),
      JSON.stringify(footer.content),
    ])
    const themeRevision = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [siteId])).rows[0]!
      .revision
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
      siteId,
      themeRevision,
      JSON.stringify({ ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, primary: '#254c99' } }),
    ])
    await client.query('COMMIT')
    const before = (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [siteId])).rows[0]!
      .payload
    const previewUrl = `/api/sites/${siteId}/sections/${definitionId}/preview`
    for (const context of ['draft', 'published', 'unrecognized']) {
      const response = await getAs(request, `${previewUrl}?site=${context}`)
      expect(response.status()).toBe(200)
      expect(response.headers()['cache-control']).toContain('private')
      expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
      expect(response.headers()['x-robots-tag']).toContain('noindex')
      const html = await response.text()
      expect(html).not.toMatch(/<script\b/i)
      expect(html).not.toContain('HTTP saved brand')
      expect(html).not.toMatch(/<(?:header|footer)\b/i)
      if (context === 'draft') {
        expect(html).toContain('--color-primary:#254c99')
      } else {
        expect(html).not.toContain('HTTP saved brand')
        expect(html).not.toContain('--color-primary:#254c99')
      }
    }
    // Both the site containing the definition and the chosen appearance site
    // must be accessible. A valid global definition must not reveal a tenant.
    for (const url of [
      previewUrl + '?site=draft',
      `/api/sites/${demoSite}/sections/${definitionId}/preview?themeSiteId=${siteId}&site=draft`,
      `/preview/${saved.version_id}?site=draft`,
    ]) {
      expect((await getAs(request, url, 'editor@example.test')).status()).toBe(404)
      expect((await request.get(url)).status()).toBe(404)
    }
    const draft = await getAs(request, `/preview/${saved.version_id}?site=draft`)
    expect(draft.status()).toBe(200)
    expect(await draft.text()).toContain('HTTP saved brand')
    const history = await getAs(request, `/preview/${saved.version_id}?readonly=1&site=draft`)
    expect(history.status()).toBe(200)
    expect(await history.text()).not.toContain('HTTP saved brand')
    for (const path of [
      `/pages/${pageId}?site=draft`,
      `/sites/${siteId}/sections?site=draft`,
      `/sites/${siteId}/sections/new`,
      `/sites/${siteId}/sections/frames`,
      `/sites/${siteId}/content`,
      `/sites/${siteId}/global-elements`,
    ]) {
      const response = await getAs(request, path)
      expect(response.status(), path).toBe(200)
      // Next serializes its unused not-found boundary in successful documents;
      // verify actual rendered content rather than searching that payload.
      expect(await response.text(), path).toContain('HTTP preview fixture')
    }
    expect(
      (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [siteId])).rows[0]!.payload,
    ).toEqual(before)
    expect((await client.query('SELECT page_id FROM published_routes WHERE site_id=$1', [siteId])).rows).toEqual([])
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (siteId) {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
      const row = (await client.query('SELECT revision FROM sites WHERE id=$1', [siteId])).rows[0]!
      await client.query('SELECT app.archive_site($1,$2)', [siteId, row.revision])
      await client.query('COMMIT')
    }
    await client.end()
  }
})
