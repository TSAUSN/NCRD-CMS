import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { expect, test, type FrameLocator } from '@playwright/test'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { signIn } from './helpers.ts'

const DB = process.env['E2E_DATABASE'] ?? 'cms_e2e'
const HOST = process.env['E2E_PG_HOST'] ?? '127.0.0.1',
  PORT = process.env['E2E_PG_PORT'] ?? '54329'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const ALT = 'A real uploaded image inside a private preview'
const RAW =
  '<script>parent.document.documentElement.dataset.privatePreviewEscape="script"</script>' +
  '<form action="/scriptless-preview-escape/form"><button type="submit">Submit private preview form</button></form>' +
  '<a href="/scriptless-preview-escape/top" target="_top">Leave private preview</a>' +
  '<iframe src="/scriptless-preview-escape/frame" title="Disallowed nested frame"></iframe>'
async function decoded(frame: FrameLocator) {
  const image = frame.getByRole('img', { name: ALT, exact: true })
  await image.scrollIntoViewIfNeeded()
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
}

test('private uploaded images decode in scriptless previews while active markup and foreign media remain blocked', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  context.setDefaultTimeout(10_000)
  if (DB === 'cms_v2_pilot') throw new Error('This test must use a disposable E2E database, never the manual pilot.')
  const client = new Client({ connectionString: `postgres://cms:cms@${HOST}:${PORT}/${DB}` })
  await client.connect()
  let rootId = '',
    sourceId = '',
    foreignSite = ''
  const suffix = Date.now().toString(),
    title = `Preview image evidence ${suffix}`,
    filename = `private-preview-${suffix}.png`
  const escaped: string[] = []
  context.on('request', request => {
    if (request.url().includes('/scriptless-preview-escape/')) escaped.push(request.url())
  })
  try {
    rootId = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const siteId = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${siteId}/media`)
    const toggle = page.getByRole('button', { name: /^(Upload images|Close upload)$/ })
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    const upload = page.getByRole('region', { name: 'Upload an image', exact: true })
    await expect(upload.getByRole('heading', { name: 'Upload an image', exact: true })).toBeVisible()
    await upload
      .getByLabel('Choose an image to upload')
      .setInputFiles({ name: filename, mimeType: 'image/png', buffer: PNG })
    await upload.getByLabel('Image description').fill(ALT)
    await upload.getByRole('button', { name: 'Upload image', exact: true }).click()
    await expect(upload.getByText(/Upload received/)).toBeVisible()
    execFileSync('pnpm', ['--filter', 'worker', 'drain'], {
      cwd: REPO,
      env: {
        ...process.env,
        DATABASE_URL_WORKER: `postgres://cms_worker_app:devpassword@${HOST}:${PORT}/${DB}`,
        APP_VERSION: 'e2e',
        WORKER_ID: `private-preview-${process.pid}`,
      },
      stdio: 'pipe',
    })
    await expect
      .poll(
        async () =>
          (await client.query('SELECT status FROM media WHERE site_id=$1 AND original_name=$2', [siteId, filename]))
            .rows[0]?.status,
      )
      .toBe('ready')
    const mediaId = (
      await client.query('SELECT id FROM media WHERE site_id=$1 AND original_name=$2', [siteId, filename])
    ).rows[0]!.id
    const mediaUrl = `/media/${mediaId}/wide`
    expect(await page.evaluate(async url => (await fetch(url, { credentials: 'same-origin' })).status, mediaUrl)).toBe(
      200,
    )

    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    const defs = (
      await client.query("SELECT id,slug FROM section_defs WHERE scope='global' AND slug IN ('hero','feature','cta')")
    ).rows
    const section = (slug: string, values: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      section_def_id: defs.find(row => row.slug === slug)!.id,
      section_def_version: 1,
      values,
      hidden: false,
      hidden_at: [],
      label: slug,
      ...extra,
    })
    sourceId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, `private-preview-${suffix}`, title])
    ).rows[0]!.id
    const content = [
      section('hero', { heading: title, intro: 'An authenticated preview image.' }),
      section('feature', {
        picture: { media_id: mediaId, variant: 'wide', src: mediaUrl, alt: ALT, decorative: false },
        more: { label: 'Home', url: '/' },
      }),
      section('cta', {}, { raw_html: RAW }),
    ]
    const source = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3,$4,$5)', [
        sourceId,
        JSON.stringify(content),
        JSON.stringify({ title, noindex: true }),
        'checkpoint',
        'Private preview browser fixture',
      ])
    ).rows[0]!
    await client.query('SELECT app.approve_trusted_code($1)', [source.version_id])
    foreignSite = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `preview-foreign-${suffix}`,
        'Isolated preview site',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    const foreignUser = (
      await client.query('SELECT app.provision_user($1,$2) AS id', [
        `preview-foreign-${suffix}@example.test`,
        'Isolated preview editor',
      ])
    ).rows[0]!.id
    await client.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', [
      `local|preview-foreign-${suffix}@example.test`,
      foreignUser,
    ])
    await client.query("SELECT app.set_site_membership($1,$2,'editor')", [foreignUser, foreignSite])
    const foreignPage = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [foreignSite, '', 'Foreign media preview'])
    ).rows[0]!.id
    const foreignVersion = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3,$4,$5)', [
        foreignPage,
        JSON.stringify([
          section('hero', { heading: 'Foreign media preview', intro: 'A tenant isolation fixture.' }),
          section('cta', {}, { raw_html: `<img src="${mediaUrl}" alt="Foreign tenant image">` }),
        ]),
        '{}',
        'checkpoint',
        'Foreign media boundary fixture',
      ])
    ).rows[0]!
    await client.query('SELECT app.approve_trusted_code($1)', [foreignVersion.version_id])
    await client.query('COMMIT')

    for (const [workspace, selector, select] of [
      ['design', 'iframe[title="Site look page preview"]', '#look-page'],
      ['global-elements', 'iframe[title$="header and footer preview"]', '#global-preview-page'],
    ] as const) {
      await page.goto(`/sites/${siteId}/${workspace}`)
      await page.locator(select).selectOption(source.version_id)
      const frame = page.frameLocator(selector)
      await decoded(frame)
      await expect(page.locator(selector)).toHaveAttribute('sandbox', 'allow-same-origin')
      await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]').first()).toHaveAttribute(
        'content',
        /script-src 'none'/,
      )
      const before = page.url()
      await frame.getByRole('button', { name: 'Submit private preview form' }).click()
      await frame.getByRole('link', { name: 'Leave private preview' }).click()
      await page.waitForTimeout(200)
      expect(page.url()).toBe(before)
      expect(await page.locator('html').getAttribute('data-private-preview-escape')).toBeNull()
      expect(escaped).toEqual([])
    }
    await page.goto(`/pages/${sourceId}/history`)
    await decoded(page.frameLocator('iframe[title^="Preview of version"]'))

    await page.goto(`/sites/${siteId}/publishing`)
    const ready = page.getByRole('region', { name: 'Changes ready to publish', exact: true })
    const changes = ready.getByRole('table', { name: 'Saved changes ready to publish', exact: true })
    for (const checkbox of await ready.getByRole('checkbox').all()) await checkbox.uncheck()
    await changes.getByRole('checkbox', { name: title, exact: true }).check()
    await expect(changes.getByRole('checkbox', { checked: true })).toHaveCount(1)
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    const review = page.getByLabel('Selected changes review', { exact: true })
    await expect(review).toBeVisible()
    const opened = context.waitForEvent('page', { timeout: 10_000 })
    await review
      .locator('summary')
      .filter({ hasText: /^Checked pages/ })
      .click()
    const imagePagePreview = review.getByRole('link', { name: title, exact: true })
    await expect(imagePagePreview).toHaveAttribute('href', new RegExp(`/preview/${sourceId}$`))
    await imagePagePreview.click()
    const release = await opened
    await expect(release).toHaveURL(new RegExp(`/releases/[^/]+/preview/${sourceId}$`))
    const releaseImage = release.getByRole('img', { name: ALT, exact: true })
    await releaseImage.scrollIntoViewIfNeeded()
    await expect
      .poll(() => releaseImage.evaluate(element => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    await release.getByRole('button', { name: 'Submit private preview form' }).click()
    expect(await release.locator('html').getAttribute('data-private-preview-escape')).toBeNull()
    expect(escaped).toEqual([])
    await release.close()

    await context.clearCookies()
    await signIn(page, `preview-foreign-${suffix}@example.test`)
    expect(await page.evaluate(async url => (await fetch(url, { credentials: 'same-origin' })).status, mediaUrl)).toBe(
      404,
    )
    await page.goto(`/sites/${foreignSite}/design`)
    const foreignImage = page
      .frameLocator('iframe[title="Site look page preview"]')
      .getByRole('img', { name: 'Foreign tenant image' })
    await foreignImage.scrollIntoViewIfNeeded()
    await expect.poll(() => foreignImage.evaluate(element => (element as HTMLImageElement).complete)).toBe(true)
    expect(await foreignImage.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(0)
    expect(
      await page.evaluate(
        async url => (await fetch(url, { credentials: 'same-origin' })).status,
        `/preview/${source.version_id}?readonly=1`,
      ),
    ).toBe(404)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    if (sourceId) {
      const row = (await client.query('SELECT revision FROM pages WHERE id=$1', [sourceId])).rows[0]
      if (row) await client.query('SELECT app.archive_page($1,$2)', [sourceId, row.revision])
    }
    if (foreignSite) {
      const row = (await client.query('SELECT revision FROM sites WHERE id=$1', [foreignSite])).rows[0]
      if (row) await client.query('SELECT app.archive_site($1,$2)', [foreignSite, row.revision])
    }
    await client.query('COMMIT')
    await client.end()
  }
})
