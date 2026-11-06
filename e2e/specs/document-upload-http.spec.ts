import { E2E_PORTS } from '../test-ports.ts'
// Built-app HTTP coverage; the collection chooser's interactive browser
// behavior is a separate acceptance gate.
import { createHmac } from 'node:crypto'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { CHECKED_CLEAN } from '@cms/schema/testing'
import { e2eTarget } from '../test-target.ts'
import { rawRequest } from './http.ts'

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
function cookie(email: string) {
  const payload = Buffer.from(JSON.stringify({ subject: `local|${email}`, email })).toString('base64url')
  return `cms_session=${payload}.${createHmac('sha256', 'e2e-secret-value-not-used-in-production').update(payload).digest('base64url')}`
}

test('HTTP PDF uploads are bounded, tenant-scoped, retry-safe and private until publication', async ({ request }) => {
  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  let foreignSiteId = '',
    rootId = ''
  try {
    const siteId = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    rootId = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    foreignSiteId = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `http-document-other-${Date.now()}`,
        'Other document tenant',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    await client.query('COMMIT')
    const endpoint = `/api/sites/${siteId}/documents`
    const headers = {
      origin: `http://127.0.0.1:${E2E_PORTS.admin}`,
      cookie: cookie('contributor@example.test'),
      'content-type': 'application/pdf',
      'x-document-name': encodeURIComponent('Guide résumé.pdf'),
    }
    const uploaded = await request.post(endpoint, { headers, data: PDF })
    expect(uploaded.status(), await uploaded.text()).toBe(201)
    const body = (await uploaded.json()) as {
      document: { id: string; url: string; bytes: number; originalName: string }
    }
    expect(body.document).toMatchObject({
      bytes: PDF.length,
      originalName: 'Guide résumé.pdf',
      url: `/assets/${body.document.id}`,
    })
    expect(uploaded.headers()['cache-control']).toBe('no-store')
    const repeated = await request.post(endpoint, {
      headers: { ...headers, cookie: cookie('editor@example.test') },
      data: PDF,
    })
    expect(repeated.status()).toBe(201)
    expect(await repeated.json()).toEqual(body)
    expect(
      Number((await client.query('SELECT count(*) FROM site_assets WHERE id=$1', [body.document.id])).rows[0]!.count),
    ).toBe(1)

    const downloaded = await request.get(body.document.url, { headers: { cookie: headers.cookie } })
    expect(downloaded.status()).toBe(200)
    expect(await downloaded.body()).toEqual(PDF)
    expect(downloaded.headers()['content-type']).toBe('application/pdf')
    expect(downloaded.headers()['content-disposition']).toContain('attachment;')
    expect(downloaded.headers()['content-disposition']).toContain(encodeURIComponent('Guide résumé.pdf'))
    expect(downloaded.headers()['cache-control']).toBe('private, no-store')
    expect(downloaded.headers()['content-security-policy']).toContain("default-src 'none'")
    expect((await request.get(body.document.url)).status()).toBe(404)
    expect((await rawRequest({ host: 'demo.staging.localhost', path: body.document.url })).status).toBe(404)

    const wrongOrigin = await request.post(endpoint, {
      headers: { ...headers, origin: 'https://other.example.test' },
      data: PDF,
    })
    expect(wrongOrigin.status()).toBe(403)
    const { cookie: _cookie, ...anonymous } = headers
    expect((await request.post(endpoint, { headers: anonymous, data: PDF })).status()).toBe(404)
    expect(
      (
        await request.post(endpoint, {
          headers: { ...headers, 'content-type': 'text/html' },
          data: '<script>bad()</script>',
        })
      ).status(),
    ).toBe(415)
    expect((await request.post(endpoint, { headers, data: '%PDF-1.4 truncated' })).status()).toBe(400)
    expect(
      (
        await request.post(endpoint, {
          headers: { ...headers, 'x-document-name': encodeURIComponent('../escape.pdf') },
          data: PDF,
        })
      ).status(),
    ).toBe(400)
    expect(
      (
        await request.post('/api/sites/99999999-9999-4999-8999-999999999999/documents', { headers, data: PDF })
      ).status(),
    ).toBe(404)
    expect((await request.post(`/api/sites/${foreignSiteId}/documents`, { headers, data: PDF })).status()).toBe(404)
    expect(
      Number((await client.query('SELECT count(*) FROM site_assets WHERE site_id=$1', [foreignSiteId])).rows[0]!.count),
    ).toBe(0)
    expect(
      Number(
        (
          await client.query('SELECT count(*) FROM site_assets WHERE site_id=$1 AND original_name=$2', [
            siteId,
            'Guide résumé.pdf',
          ])
        ).rows[0]!.count,
      ),
    ).toBe(1)

    // Exercise actual bytes across the separate admin/site application roles,
    // not merely the SQL resolver's metadata. Publication here is synthetic.
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    const pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        siteId,
        `http-document-${Date.now()}`,
        'HTTP document download',
      ])
    ).rows[0]!.id
    const definition = (
      await client.query(
        "SELECT d.id,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='prose' AND d.scope='global' ORDER BY v.version DESC LIMIT 1",
      )
    ).rows[0]!
    const draft = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        pageId,
        JSON.stringify([
          {
            section_def_id: definition.id,
            section_def_version: definition.version,
            values: {
              title: 'Document download',
              body: `<p><a href="${body.document.url}">Download the report</a></p>`,
            },
          },
        ]),
        JSON.stringify({
          title: 'HTTP document download',
          description: 'An isolated test document download',
          noindex: true,
        }),
      ])
    ).rows[0]!
    // This known-safe fixture states its readiness explicitly, as the real-role
    // policy fixtures do. The application's evaluator has its own DB coverage.
    await client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [pageId, draft.revision, ...CHECKED_CLEAN])
    await client.query('COMMIT')
    const publicDocument = await rawRequest({ host: 'demo.staging.localhost', path: body.document.url })
    expect(publicDocument.status).toBe(200)
    expect(publicDocument.body).toBe(PDF.toString())
    expect(publicDocument.headers['content-disposition']).toContain('attachment;')
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    const revision = (await client.query('SELECT revision FROM pages WHERE id=$1', [pageId])).rows[0]!.revision
    await client.query('SELECT app.archive_page($1,$2)', [pageId, revision])
    await client.query('COMMIT')
    expect((await rawRequest({ host: 'demo.staging.localhost', path: body.document.url })).status).toBe(404)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (foreignSiteId) {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
      const row = (await client.query('SELECT revision FROM sites WHERE id=$1', [foreignSiteId])).rows[0]!
      await client.query('SELECT app.archive_site($1,$2)', [foreignSiteId, row.revision])
      await client.query('COMMIT')
    }
    await client.end()
  }
})
