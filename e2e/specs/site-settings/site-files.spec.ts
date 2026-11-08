import { E2E_PORTS } from '../../test-ports.ts'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Pool } from 'pg'
import { test, expect, type Page, type Locator, type Request } from '@playwright/test'
import { compileSection, sectionScopeSelector } from '../../../packages/renderer/src/index.ts'
import { registerReviewedSiteFile } from '../../../packages/platform/src/site-files.ts'
import { importFrozenSiteAsset } from '../../../packages/platform/src/site-assets.ts'
import { processMediaBytes } from '../../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
import { e2eTarget } from '../../test-target.ts'
import { signIn } from '../helpers.ts'
import { rawRequest } from '../http.ts'
const folder = resolve('../.r8-progress/step-5/reviewed-files')
async function capture(page: Page, name: string, focus?: Locator) {
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    if (await page.locator('#editor-panes').count()) {
      const panes = page.locator('#editor-panes')
      await expect
        .poll(() =>
          panes.evaluate(async node => {
            const measure = () =>
              JSON.stringify([innerWidth, node.clientWidth, (node as HTMLElement).dataset.collapsed])
            const before = measure()
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            return before === measure()
          }),
        )
        .toBe(true)
      const openStructure = page.getByRole('button', { name: 'Open Structure', exact: true })
      const structureWasClosed = await openStructure.isVisible()
      if (structureWasClosed) await openStructure.click()
      for (const name of ['Page structure', 'Inspector']) {
        const panel = page.getByRole('complementary', { name, exact: true })
        if (await panel.isVisible())
          await expect
            .poll(
              () =>
                panel.evaluate(async node => {
                  await document.fonts.ready
                  const measure = () => {
                    const r = node.getBoundingClientRect()
                    return { left: r.left, right: r.right, width: innerWidth }
                  }
                  const first = measure()
                  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
                  const second = measure()
                  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
                  const bounds = measure()
                  const stable =
                    JSON.stringify(first) === JSON.stringify(second) &&
                    JSON.stringify(second) === JSON.stringify(bounds)
                  return stable && bounds.left >= -1 && bounds.right <= bounds.width + 1
                }),
              { message: name + ' stays inside the workspace' },
            )
            .toBe(true)
      }
      if (structureWasClosed) await page.getByRole('button', { name: 'Close Structure', exact: true }).click()
      await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
      await expect
        .poll(() =>
          page.locator('iframe[title="Page canvas"]').evaluate(node => {
            const frame = node.getBoundingClientRect(),
              viewport = node.closest<HTMLElement>('.canvas-viewport')!,
              view = viewport.getBoundingClientRect(),
              fit = Math.min(
                node.clientWidth,
                viewport.clientWidth - parseFloat(getComputedStyle(viewport).paddingInlineStart || '0'),
              )
            return (
              frame.left >= view.left - 1 &&
              frame.right <= view.right + 1 &&
              (viewport.dataset.zoom !== 'fit' || Math.abs(frame.width - fit) < 1)
            )
          }),
        )
        .toBe(true)
    }
    if (focus) await focus.evaluate(node => node.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled', scale: 'css' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
function script(label: string) {
  return `window.cmsScriptOrder=(window.cmsScriptOrder||[]);window.cmsScriptOrder.push('${label}');document.documentElement.dataset.approvedScript=window.cmsScriptOrder.join(',');`
}
async function fixture() {
  const target = e2eTarget(),
    pool = new Pool({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` }),
    client = await pool.connect(),
    suffix = randomUUID().slice(0, 8),
    host = `r8-files-${suffix}.staging.localhost`
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const tokens = (
      await client.query(
        "SELECT v.tokens FROM themes h JOIN sites s ON s.id=h.site_id JOIN theme_versions v ON v.id=h.published_version_id WHERE s.slug='demo'",
      )
    ).rows[0]!.tokens
    const site = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `r8-files-${suffix}`,
        'Reviewed interaction files',
        'general',
        host,
        JSON.stringify(tokens),
        '[]',
      ])
    ).rows[0]!.id
    const editor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, site])
    const def = (
      await client.query(
        "SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    const pages: string[] = []
    for (const [path, title] of [
      ['', 'Approved script home'],
      ['other', 'Other page'],
    ]) {
      const page = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, path, title])).rows[0]!.id
      pages.push(page)
      await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([
          {
            section_def_id: def.id,
            section_def_version: Number(def.version),
            values: { heading: title, intro: 'This content is complete before any JavaScript runs.' },
            hidden: false,
            hidden_at: [],
            label: 'Hero',
          },
        ]),
        JSON.stringify({ description: 'A local proof of reviewed site interaction files.' }),
      ])
    }
    await client.query('SELECT app.publish_theme($1,1)', [site])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [site])
    for (const page of pages) await client.query("SELECT app.publish_page($1,1,3,NULL,'[]')", [page])
    const nav = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [site])).rows[0]!
    await client.query('SELECT app.publish_navigation($1,$2)', [site, nav.revision])
    await client.query('COMMIT')
    return { pool, site, host, pages, base: `/sites/${site}`, url: `http://${host}:${E2E_PORTS.site}` }
  } catch (error) {
    await client.query('ROLLBACK')
    await pool.end()
    throw error
  } finally {
    client.release()
  }
}
async function upload(page: Page, name: string, content: string, source = 'local:js/' + name) {
  await page.getByLabel('Local file', { exact: true }).setInputFiles({
    name,
    mimeType: name.endsWith('.css') ? 'text/css' : 'text/javascript',
    buffer: Buffer.from(content),
  })
  await page.getByRole('textbox', { name: /^Original source/ }).fill(source)
  await page.getByRole('button', { name: /^Add (?:file|replacement) to review$/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'File added to your choices.' })).toBeVisible()
}
async function approve(page: Page, captureReview = false) {
  await page.getByRole('button', { name: 'Review file changes', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review site file changes', exact: true })
  await expect(review.getByRole('button', { name: 'Save reviewed version', exact: true })).toBeDisabled()
  if (captureReview) await capture(page, 'file-review-unconfirmed')
  await review.getByRole('checkbox', { name: /I reviewed every file/ }).check()
  await review.getByRole('button', { name: 'Save reviewed version', exact: true }).click()
  await expect(review).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'Reviewed version saved.' })).toBeVisible()
}
async function publishFiles(page: Page) {
  await page.getByRole('link', { name: 'Review publication', exact: true }).click()
  await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
  const review = page.getByLabel('Selected changes review', { exact: true })
  await expect(review).toContainText('Site scripts and files')
  await review.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Release applied. The selected changes took effect together.' }),
  ).toBeVisible()
}
let f: Awaited<ReturnType<typeof fixture>>
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  f = await fixture()
})
test.afterAll(async () => {
  await f?.pool.end()
})
test('imported pictures retain the editor warning and omit unavailable originals from rendered pages', async ({
  page,
  browser,
  browserName,
}) => {
  test.setTimeout(120000)
  const g = await fixture(),
    client = await g.pool.connect(),
    requests: string[] = []
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  try {
    const before = await rawRequest({ host: g.host, path: '/' })
    await client.query('BEGIN')
    await client.query(
      "SELECT set_config('app.user_id',(SELECT id::text FROM app_users WHERE email='root@example.test'),true)",
    )
    const image = await registerReviewedSiteFile({
      client,
      store: createFilesystemMediaStore(defaultMediaRoot()),
      siteId: g.site,
      kind: 'image',
      name: 'picture.svg',
      source: 'local:picture.svg',
      bytes: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="navy"/></svg>',
      ),
    })
    const slug = 'picture-preview-' + randomUUID().slice(0, 8),
      slots = [{ id: 'picture', kind: 'image' as const, label: 'Picture', constraints: {} }],
      source = '<section><h2>Original picture</h2><img src="{{picture}}" alt="{{picture}}"></section>',
      compiled = compileSection({ sourceHtml: source, slots, scopeSelector: sectionScopeSelector(slug)! })
    const definition = (
      await client.query(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          slug,
          'Original picture',
          'Original',
          source,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Local picture preview check',
          false,
          'legacy',
          null,
          null,
          'site',
          g.site,
        ],
      )
    ).rows[0]!.section_def_id
    const head = (
      await client.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [g.pages[0]],
      )
    ).rows[0]!
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      g.pages[0],
      head.revision,
      JSON.stringify([
        ...head.content,
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Original picture',
          values: { picture: { src: '/images/picture.svg', alt: 'Original local picture' } },
        },
      ]),
      JSON.stringify(head.meta),
    ])
    await client.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      g.site,
      JSON.stringify({
        version: 1,
        files: [image.id],
        scripts: [],
        styles: [],
        paths: [{ path: '/images/picture.svg', fileId: image.id }],
        original: {
          version: 1,
          definitions: [{ section_def_id: definition, section_def_version: 1 }],
          pages: g.pages.map(pageId => ({ pageId, html: { lang: 'en' }, body: {}, header: false, footer: false })),
        },
      }),
    ])
    await client.query('COMMIT')
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + g.pages[0] + '?site=draft')
    await page.getByRole('complementary', { name: 'Page structure', exact: true }).locator('.tree-label').last().click()
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true }),
      preview = inspector.locator('.image-preview')
    const address = '/site-files/' + image.id + '/' + image.sha256 + '/' + image.name
    await expect(preview).toHaveAttribute('src', address)
    await expect
      .poll(() =>
        preview.evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
      )
      .toBe(true)
    expect((await page.context().request.get(address)).status()).toBe(200)
    await capture(page, 'imported-picture-inspector-' + browserName)
    await inspector.getByText('Use a picture from another website', { exact: true }).click()
    await inspector.getByLabel('Picture address', { exact: true }).fill('/images/unavailable-original.png')
    await expect(
      inspector.getByText('The original picture is unavailable. Choose a picture from the media library.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(preview).toHaveCount(0)
    await expect(page.getByText('Updating page preview…', { exact: true })).toHaveCount(0)
    const pictureSection = page
      .frameLocator('iframe[title="Page canvas"]')
      .locator('section')
      .filter({ hasText: 'Original picture' })
    await expect(pictureSection).toBeVisible()
    await expect(pictureSection.locator('img')).toHaveCount(0)
    await expect(
      page.frameLocator('iframe[title="Page canvas"]').locator('img[src*="unavailable-original.png"]'),
    ).toHaveCount(0)
    await capture(page, 'unavailable-original-picture-' + browserName)
    expect(requests).not.toContain('/images/picture.svg')
    expect(requests).not.toContain('/images/unavailable-original.png')
    const foreign = await browser.newContext(),
      other = await foreign.newPage()
    await signIn(other, 'contributor@example.test')
    expect((await foreign.request.get(new URL(address, page.url()).href)).status()).toBe(404)
    await foreign.close()
    expect((await rawRequest({ host: g.host, path: '/' })).body).toBe(before.body)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await g.pool.end()
  }
})
test('reviewed site files: real upload, explicit review, release, ordered behavior, exact CSP, no-JS HTML and isolation', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const baseline = await rawRequest({ host: f.host, path: '/' })
  await signIn(page, 'root@example.test')
  await page.goto(f.base + '/settings')
  if (await page.getByRole('link', { name: 'Advanced', exact: true }).count())
    await page.getByRole('link', { name: 'Advanced', exact: true }).click()
  await page.getByRole('link', { name: 'Manage site scripts and files', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No site scripts or files', exact: true })).toBeVisible()
  await capture(page, 'file-list-empty')
  await capture(
    page,
    'file-list-empty-content',
    page.getByRole('heading', { name: 'No site scripts or files', exact: true }),
  )
  let releaseUpload!: () => void
  const uploadGate = new Promise<void>(resolve => {
    releaseUpload = resolve
  })
  await page.route(
    '**/api/sites/' + f.site + '/files',
    async route => {
      await uploadGate
      await route.continue()
    },
    { times: 1 },
  )
  await page
    .getByLabel('Local file', { exact: true })
    .setInputFiles({ name: 'first.js', mimeType: 'text/javascript', buffer: Buffer.from(script('first')) })
  await page.getByRole('textbox', { name: /^Original source/ }).fill('local:js/first.js')
  await page.getByRole('button', { name: 'Add file to review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Adding file…', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Local file', { exact: true })).toBeDisabled()
  await capture(page, 'file-upload-pending')
  releaseUpload()
  await expect(page.getByRole('status').filter({ hasText: 'File added to your choices.' })).toBeVisible()
  await upload(
    page,
    'second.js',
    script('second'),
    'https://static.example.test/original-event-assets/long-source-path-for-reviewed-interactions-and-accessible-carousel-controls/second.js',
  )
  await upload(page, 'proof.css', 'h1{text-decoration:underline}')
  const first = page.getByRole('article', { name: 'first.js loading choices', exact: true })
  await first.getByLabel('Position', { exact: true }).selectOption('head')
  await first.getByLabel('Show on', { exact: true }).selectOption('chosen')
  await expect(first.getByRole('checkbox', { name: 'Approved script home', exact: true })).toBeChecked()
  await expect(first.getByRole('checkbox', { name: 'Other page', exact: true })).not.toBeChecked()
  await capture(page, 'file-choices-order-and-pages', first)
  expect((await rawRequest({ host: f.host, path: '/' })).body).not.toContain('/site-files/')
  await approve(page, true)
  await capture(page, 'file-version-reviewed-private')
  const privateFiles = (
    await f.pool.query(
      "SELECT f.id,f.sha256,f.name FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id JOIN site_files f ON f.site_id=h.site_id AND v.bundle->'files' @> to_jsonb(ARRAY[f.id::text]) WHERE h.site_id=$1",
      [f.site],
    )
  ).rows
  const address = (name: string) => {
    const file = privateFiles.find(file => file.name === name)!
    return `/site-files/${file.id}/${file.sha256}/${file.name}`
  }
  expect((await rawRequest({ host: f.host, path: address('first.js') })).status).toBe(404)
  await publishFiles(page)
  const live = await rawRequest({ host: f.host, path: '/' }),
    other = await rawRequest({ host: f.host, path: '/other' })
  expect(live.status).toBe(200)
  expect(live.body).toContain('This content is complete before any JavaScript runs.')
  expect(live.body.indexOf(address('first.js'))).toBeLessThan(live.body.indexOf('</head>'))
  expect(live.body.indexOf(address('second.js'))).toBeGreaterThan(live.body.indexOf('<body>'))
  const firstHash = 'sha256-' + createHash('sha256').update(script('first')).digest('base64'),
    secondHash = 'sha256-' + createHash('sha256').update(script('second')).digest('base64')
  expect(live.headers['content-security-policy']).toContain(`script-src '${firstHash}' '${secondHash}'`)
  expect(live.headers['content-security-policy']).not.toMatch(/script-src[^;]*(?:unsafe-inline|'self')/)
  expect(other.headers['content-security-policy']).not.toContain(firstHash)
  expect(other.body).not.toContain(address('first.js'))
  expect(other.body).toContain(address('second.js'))
  const publicPage = await page.context().newPage()
  await publicPage.goto(f.url)
  await expect(publicPage.locator('html')).toHaveAttribute('data-approved-script', 'first,second')
  await expect(publicPage.locator('h1')).toHaveCSS('text-decoration-line', 'underline')
  for (const width of [1440, 1024, 390]) {
    await publicPage.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await publicPage.screenshot({ path: resolve(folder, 'approved-public-' + width + '.png') })
  }
  await publicPage.goto(f.url + '/other')
  await expect(publicPage.locator('html')).toHaveAttribute('data-approved-script', 'second')
  await publicPage.close()
  const noJs = await browser.newContext({ javaScriptEnabled: false })
  const staticPage = await noJs.newPage()
  await staticPage.goto(f.url)
  await expect(staticPage.getByRole('heading', { name: 'Approved script home', exact: true })).toBeVisible()
  await expect(
    staticPage.getByText('This content is complete before any JavaScript runs.', { exact: true }),
  ).toBeVisible()
  await noJs.close()
  expect((await rawRequest({ host: 'demo.staging.localhost', path: address('first.js') })).status).toBe(404)
  expect(
    (
      await rawRequest({
        host: f.host,
        path: address('first.js').replace(/\/[a-f0-9]{64}\//, '/' + 'b'.repeat(64) + '/'),
      })
    ).status,
  ).toBe(404)
  const receipt = (
      await f.pool.query('SELECT object_key FROM site_files WHERE id=$1', [
        privateFiles.find(file => file.name === 'first.js')!.id,
      ])
    ).rows[0]!,
    path = join(defaultMediaRoot(), receipt.object_key),
    original = await readFile(path)
  try {
    await writeFile(path, 'changed after approval')
    expect((await rawRequest({ host: f.host, path: address('first.js') })).status).toBe(404)
  } finally {
    await writeFile(path, original)
  }
  expect((await rawRequest({ host: f.host, path: address('first.js') })).body).toBe(script('first'))
  await page.goto(f.base + '/scripts')
  await page
    .getByLabel('Local file', { exact: true })
    .setInputFiles({ name: 'bad.js', mimeType: 'text/javascript', buffer: Buffer.from('<script>bad()</script>') })
  await page.getByRole('button', { name: 'Add file to review', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Choose a complete supported site file.')
  await capture(page, 'file-upload-refused', page.getByRole('main').getByRole('alert'))
  await page.getByLabel('Local file', { exact: true }).setInputFiles([])
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in(?:[?#]|$)/)
  await signIn(page, 'editor@example.test')
  const denied = await page.goto(f.base + '/scripts')
  expect(denied?.status()).toBe(404)
  await page.goto(f.base + '/settings')
  if (await page.getByRole('link', { name: 'Advanced', exact: true }).count())
    await page.getByRole('link', { name: 'Advanced', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Manage site scripts and files', exact: true })).toHaveCount(0)
  await capture(page, 'editor-settings-without-script-access')
  const refused = await page.request.post(f.base.replace('/sites/', '/api/sites/') + '/files', {
    headers: {
      origin: `http://127.0.0.1:${E2E_PORTS.admin}`,
      'content-type': 'application/octet-stream',
      'x-site-file-name': 'bad.js',
      'x-site-file-source': 'local%3Abad.js',
      'x-site-file-kind': 'script',
    },
    data: script('unapproved'),
  })
  expect(refused.status()).toBe(404)
  expect(errors).toEqual([])
  expect(baseline.headers['content-security-policy']).not.toContain(firstHash)
})
test('reviewed site files: replacement, removal and restoration retain immutable versions and require another release', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  await signIn(page, 'root@example.test')
  await page.goto(f.base + '/scripts')
  await page.getByRole('button', { name: 'Replace first.js', exact: true }).click()
  await upload(page, 'first.js', script('replacement'), 'local:js/first-v2.js')
  await approve(page)
  expect((await rawRequest({ host: f.host, path: '/' })).body).not.toContain(
    createHash('sha256').update(script('replacement')).digest('hex'),
  )
  await publishFiles(page)
  const publicPage = await page.context().newPage()
  await publicPage.goto(f.url)
  await expect(publicPage.locator('html')).toHaveAttribute('data-approved-script', 'replacement,second')
  await publicPage.close()
  await page.goto(f.base + '/scripts')
  for (const name of ['first.js', 'second.js', 'proof.css'])
    await page.getByRole('button', { name: 'Remove ' + name, exact: true }).click()
  await approve(page)
  await publishFiles(page)
  const removed = await rawRequest({ host: f.host, path: '/' })
  expect(removed.body).not.toContain('/site-files/')
  expect(removed.headers['content-security-policy']).not.toContain('script-src')
  await page.goto(f.base + '/scripts')
  await capture(
    page,
    'retained-file-version-history',
    page.getByRole('heading', { name: 'Reviewed versions', exact: true }),
  )
  await page.getByRole('button', { name: 'Restore version 1 as choices', exact: true }).click()
  await approve(page)
  await publishFiles(page)
  const restored = await page.context().newPage()
  await restored.goto(f.url)
  await expect(restored.locator('html')).toHaveAttribute('data-approved-script', 'first,second')
  await restored.close()
  const versions = (
    await f.pool.query('SELECT version,bundle FROM site_file_versions WHERE site_id=$1 ORDER BY version', [f.site])
  ).rows
  expect(versions).toHaveLength(4)
  expect(versions[0]!.bundle).toEqual(versions[3]!.bundle)
  expect(versions[2]!.bundle.files).toEqual([])
  expect(
    (
      await f.pool.query(
        "SELECT count(*)::integer AS count FROM audit_log WHERE site_id=$1 AND action='site.files.review'",
        [f.site],
      )
    ).rows[0]!.count,
  ).toBe(4)
})

test('reviewed original web addresses retain relative CSS, font, image and script behavior through review, release and replacement', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const g = await fixture(),
    client = await g.pool.connect(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const store = createFilesystemMediaStore(defaultMediaRoot())
    const add = (kind: 'script' | 'stylesheet' | 'font' | 'image' | 'data', name: string, bytes: Uint8Array) =>
      registerReviewedSiteFile({
        client,
        store,
        siteId: g.site,
        kind,
        name,
        source: 'local:original-path-proof/' + name,
        bytes,
      })
    const js = await add(
      'script',
      'original.js',
      Buffer.from(
        "fetch('js/items.json?source=fetch').then(r=>r.json()).then(data=>document.documentElement.dataset.originalFetch=data.proof);const x=new XMLHttpRequest();x.open('GET','js/items.json?source=xhr');x.onload=()=>document.documentElement.dataset.originalXhr=JSON.parse(x.responseText).proof;x.send();",
      ),
    )
    const css = await add(
      'stylesheet',
      'original.css',
      Buffer.from(
        '@font-face{font-family:OriginalProof;src:url(../fonts/open-sans.woff2) format("woff2")}h1{font-family:OriginalProof,sans-serif}main{background-image:url(../images/proof.svg);background-repeat:no-repeat}h1:hover{opacity:.8;transition:opacity .2s}',
      ),
    )
    const font = await add(
      'font',
      'open-sans.woff2',
      await readFile(resolve('../node_modules/@fontsource/open-sans/files/open-sans-latin-400-normal.woff2')),
    )
    const image = await add(
      'image',
      'proof.svg',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="red"/></svg>',
      ),
    )
    const data = await add('data', 'items.json', Buffer.from('{"proof":"original files work"}'))
    const oldAddress = `/site-files/${randomUUID()}/${js.sha256}/${js.name}`
    const paths = [
      { path: '/js/original.js', fileId: js.id },
      { path: '/css/original.css', fileId: css.id },
      { path: '/fonts/open-sans.woff2', fileId: font.id },
      { path: '/images/proof.svg', fileId: image.id },
      { path: '/js/items.json', fileId: data.id },
      { path: oldAddress, fileId: js.id },
    ]
    await client.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      g.site,
      JSON.stringify({
        version: 1,
        files: [js.id, css.id, font.id, image.id, data.id],
        scripts: [{ fileId: js.id, position: 'body-end', loading: 'normal', pages: [] }],
        styles: [{ fileId: css.id, pages: [] }],
        paths,
      }),
    ])
    await client.query('COMMIT')
    for (const { path } of paths) expect((await rawRequest({ host: g.host, path })).status).toBe(404)
    await signIn(page, 'root@example.test')
    await page.goto(g.base + '/scripts')
    const choices = page.getByRole('article', { name: 'original.js loading choices', exact: true })
    await expect(choices).toContainText('/js/original.js')
    await expect(choices).toContainText(oldAddress)
    await choices.getByLabel('Position', { exact: true }).selectOption('head')
    await capture(page, 'original-path-choices-' + browserName, choices)
    await page.getByRole('button', { name: 'Review file changes', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Review site file changes', exact: true })
    await expect(review).toContainText('/css/original.css')
    await expect(review).toContainText(oldAddress)
    await capture(page, 'original-path-review-' + browserName)
    await review.getByRole('checkbox', { name: /I reviewed every file/ }).check()
    await review.getByRole('button', { name: 'Save reviewed version', exact: true }).click()
    await expect(review).toBeHidden()
    await publishFiles(page)
    const live = await rawRequest({ host: g.host, path: '/' })
    expect(live.body).toContain('src="/js/original.js"')
    expect(live.body).toContain('href="/css/original.css"')
    expect(live.headers['content-security-policy']).toContain(
      "'sha256-" + Buffer.from(js.sha256, 'hex').toString('base64') + "'",
    )
    expect(live.body).toContain('This content is complete before any JavaScript runs.')
    const publicPage = await page.context().newPage()
    publicPage.on('pageerror', error => errors.push(error.message))
    await publicPage.goto(g.url)
    expect(await publicPage.evaluate(() => document.compatMode)).toBe('CSS1Compat')
    await expect(publicPage.locator('html')).toHaveAttribute('data-original-fetch', 'original files work')
    await expect(publicPage.locator('html')).toHaveAttribute('data-original-xhr', 'original files work')
    await expect.poll(() => publicPage.evaluate(() => document.fonts.check('16px OriginalProof'))).toBe(true)
    await expect(publicPage.locator('main')).toHaveCSS('background-image', /images\/proof\.svg/)
    for (const width of [1440, 1024, 390]) {
      await publicPage.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await publicPage.screenshot({
        path: resolve(folder, 'original-path-public-' + browserName + '-' + width + '.png'),
      })
    }
    await publicPage.close()
    for (const { path } of paths) {
      expect((await rawRequest({ host: g.host, path })).status).toBe(200)
      expect((await rawRequest({ host: g.host, path, method: 'HEAD' })).body).toBe('')
      expect((await rawRequest({ host: 'demo.staging.localhost', path })).status).toBe(404)
    }
    expect((await rawRequest({ host: g.host, path: '/js/unknown.js' })).status).toBe(404)
    const receipt = (await client.query('SELECT object_key FROM site_files WHERE id=$1', [js.id])).rows[0]!,
      filePath = join(defaultMediaRoot(), receipt.object_key),
      original = await readFile(filePath)
    try {
      await writeFile(filePath, 'changed after approval')
      for (const path of ['/js/original.js', oldAddress])
        expect((await rawRequest({ host: g.host, path })).status).toBe(404)
    } finally {
      await writeFile(filePath, original)
    }
    await page.goto(g.base + '/scripts')
    await page.getByRole('button', { name: 'Replace original.js', exact: true }).click()
    await upload(page, 'original.js', script('new-original'))
    await approve(page)
    expect((await rawRequest({ host: g.host, path: '/js/original.js' })).body).toBe(original.toString())
    await publishFiles(page)
    expect((await rawRequest({ host: g.host, path: '/js/original.js' })).body).toBe(script('new-original'))
    expect((await rawRequest({ host: g.host, path: oldAddress })).body).toBe(original.toString())
    expect(errors).toEqual([])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await g.pool.end()
  }
})
test('site archives require a fresh file review, retain all versions privately, and publish unchanged original addresses', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'root@example.test')
  await page.goto(f.base + '/settings')
  if (await page.getByRole('link', { name: 'Advanced', exact: true }).count())
    await page.getByRole('link', { name: 'Advanced', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download content archive', exact: true }).click()
  const download = await downloadPromise,
    bytes = await readFile((await download.path())!),
    archive = JSON.parse(bytes.toString())
  expect(archive.content.site_files).toHaveLength(4)
  expect(archive.content.site_file_versions).toHaveLength(4)
  await page.goto('/sites/import')
  await capture(page, 'archive-empty-' + browserName)
  await page
    .getByLabel('Content archive (.json, up to 64 MB)')
    .setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByRole('main').getByRole('alert')).toContainText('not a supported site content archive')
  await capture(page, 'archive-invalid-' + browserName)
  await page
    .getByLabel('Content archive (.json, up to 64 MB)')
    .setInputFiles({ name: 'reviewed-files.json', mimeType: 'application/json', buffer: bytes })
  await page.getByLabel('New site name', { exact: true }).fill('Reviewed files archive copy')
  const slug = 'files-copy-' + randomUUID().slice(0, 8)
  await page.getByLabel('New short address', { exact: true }).fill(slug)
  const create = page.getByRole('button', { name: 'Create private draft copy', exact: true })
  await expect(create).toBeDisabled()
  await expect(page.getByRole('heading', { name: "Review the site's files", exact: true })).toBeVisible()
  for (const file of archive.content.site_files) {
    await expect(
      page
        .getByRole('listitem')
        .filter({ has: page.getByText(file.name, { exact: true }) })
        .filter({ hasText: file.source }),
    ).toContainText(file.source)
  }
  await capture(
    page,
    'archive-review-unconfirmed-' + browserName,
    page.getByRole('heading', { name: "Review the site's files", exact: true }),
  )
  const refused = await page.request.post('/api/sites/import', {
    headers: { origin: `http://127.0.0.1:${E2E_PORTS.admin}` },
    data: {
      requestId: randomUUID(),
      destination: { slug: 'no-review-' + randomUUID().slice(0, 8), name: 'No review' },
      archive,
    },
  })
  expect(refused.status()).toBe(400)
  await page.getByRole('checkbox', { name: 'I reviewed every site file, its size and source.', exact: true }).check()
  await expect(create).toBeEnabled()
  let release!: () => void
  const waiting = new Promise<void>(resolve => {
    release = resolve
  })
  await page.route(
    '**/api/sites/import',
    async route => {
      await waiting
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Import could not be confirmed. Retry with the same file and destination.' }),
      })
    },
    { times: 1 },
  )
  await create.click()
  await expect(page.getByRole('button', { name: 'Importing content…', exact: true })).toBeDisabled()
  await capture(page, 'archive-pending-' + browserName)
  release()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Import could not be confirmed.')
  await capture(page, 'archive-retry-' + browserName, page.getByRole('main').getByRole('alert'))
  await create.click()
  await expect(page.getByRole('status')).toContainText('Your site content was imported as private drafts.')
  await capture(page, 'archive-imported-private-' + browserName, page.getByRole('status'))
  const link = page.getByRole('link', { name: 'Open imported site', exact: true }),
    copyId = (await link.getAttribute('href'))!.split('/').at(-1)!,
    host = slug + '.staging.localhost'
  expect((await rawRequest({ host, path: '/' })).status).toBe(404)
  const metadata = (
    await f.pool.query('SELECT id,name,sha256,source FROM site_files WHERE site_id=$1 ORDER BY id', [copyId])
  ).rows
  expect(metadata).toHaveLength(4)
  expect(metadata.every(row => !archive.content.site_files.some((file: { id: string }) => file.id === row.id))).toBe(
    true,
  )
  const head = (
    await f.pool.query('SELECT revision,published_version_id FROM site_file_heads WHERE site_id=$1', [copyId])
  ).rows[0]!
  expect(head).toEqual({ revision: String(archive.content.site_file_heads[0].revision), published_version_id: null })
  await page.goto('/sites/' + copyId + '/publishing')
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  const review = page.getByLabel('Selected changes review', { exact: true })
  await expect(review).toContainText('Site scripts and files')
  await review.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Release applied. The selected changes took effect together.' }),
  ).toBeVisible()
  const publicPage = await page.context().newPage()
  publicPage.on('pageerror', error => errors.push(error.message))
  await publicPage.goto('http://' + host + `:${E2E_PORTS.site}`)
  await expect(publicPage.locator('html')).toHaveAttribute('data-approved-script', 'first,second')
  await expect(publicPage.locator('h1')).toHaveCSS('text-decoration-line', 'underline')
  for (const width of [1440, 1024, 390]) {
    await publicPage.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await publicPage.screenshot({ path: resolve(folder, 'archive-public-' + browserName + '-' + width + '.png') })
  }
  await publicPage.close()
  const original = archive.content.site_files.find(
      (file: { name: string; source: string }) => file.name === 'first.js' && file.source === 'local:js/first.js',
    )!,
    oldPath = `/site-files/${original.id}/${original.sha256}/${original.name}`
  expect((await rawRequest({ host, path: oldPath })).body).toBe(script('first'))
  const copiedFile = metadata.find(row => row.name === 'first.js' && row.source === 'local:js/first.js')!
  expect(
    (await rawRequest({ host: f.host, path: `/site-files/${copiedFile.id}/${copiedFile.sha256}/${copiedFile.name}` }))
      .status,
  ).toBe(404)
  expect(errors).toEqual([])
})

test('unchanged reviewed files retain native image and PDF addresses through two transfers, private previews and explicit removal', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(10000)
  const g = await fixture(),
    client = await g.pool.connect(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
    mediaId = randomUUID(),
    privateMediaId = randomUUID(),
    pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
    store = createFilesystemMediaStore(defaultMediaRoot())
  let jsSource = '',
    imagePath = '',
    pdfPath = '',
    scriptId = '',
    scriptHash = '',
    nativeBundle: unknown
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const input = await readFile(resolve('../apps/admin/public/cms-samples/r8-square.png'))
    const processed = await processMediaBytes(
      {
        intentId: randomUUID(),
        siteId: g.site,
        uploadObjectKey: 'native-proof/input.png',
        finalKeyPrefix: 'native-proof/' + g.site + '/' + mediaId + '/',
        declaredMime: 'image/png',
        declaredBytes: input.length,
      },
      input,
    )
    const original = processed.original
    for (const [id, name, description] of [
      [mediaId, 'original-image.png', 'Designed geometric sample'],
      [privateMediaId, 'private-draft.png', 'A private unpublished draft image'],
    ]) {
      const key = original.objectKey.replace(mediaId, id!)
      await store.put(key, original.data, original.mimeType)
      await client.query(
        "INSERT INTO media(id,site_id,object_key,content_hash,mime_type,status,bytes,width,height,alt_text,original_name,source) VALUES($1,$2,$3,$4,$5,'ready',$6,$7,$8,$9,$10,$11)",
        [
          id,
          g.site,
          key,
          original.sha256,
          original.mimeType,
          original.bytes,
          original.width,
          original.height,
          description,
          name,
          'local:native-proof/' + name,
        ],
      )
      for (const variant of processed.variants) {
        const key = variant.objectKey.replace(mediaId, id!)
        await store.put(key, variant.data, variant.mimeType)
        await client.query(
          'INSERT INTO media_variants(media_id,kind,object_key,content_hash,mime_type,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [id, variant.kind, key, variant.sha256, variant.mimeType, variant.bytes, variant.width, variant.height],
        )
      }
    }
    const asset = await importFrozenSiteAsset({
      client,
      store,
      siteId: g.site,
      bytes: pdfBytes,
      kind: 'document',
      originalName: 'original-document.pdf',
      provenance: {
        path: 'local:native-proof/original-document.pdf',
        sha256: digest(pdfBytes),
        manifest_sha256: digest(pdfBytes),
      },
    })
    imagePath = '/media/' + mediaId + '/card'
    pdfPath = asset.url
    jsSource =
      "const image=new Image();image.alt='An image from an unchanged script';image.onload=()=>document.documentElement.dataset.nativeImage='loaded';image.src='" +
      imagePath +
      "';document.body.append(image);fetch('" +
      pdfPath +
      "').then(r=>{if(!r.ok)throw Error('Original document unavailable');return r.text()}).then(text=>document.documentElement.dataset.nativeDocument=text.startsWith('%PDF-1.4')?'loaded':'wrong');"
    const js = await registerReviewedSiteFile({
        client,
        store,
        siteId: g.site,
        kind: 'script',
        name: 'native-original.js',
        source: 'local:native-proof/native-original.js',
        bytes: Buffer.from(jsSource),
      }),
      css = await registerReviewedSiteFile({
        client,
        store,
        siteId: g.site,
        kind: 'stylesheet',
        name: 'native-original.css',
        source: 'local:native-proof/native-original.css',
        bytes: Buffer.from(
          'main{background-image:url("' +
            imagePath +
            '");background-repeat:no-repeat;background-position:right top;background-size:96px}body>img{width:96px;height:96px}',
        ),
      })
    scriptId = js.id
    scriptHash = js.sha256
    nativeBundle = {
      version: 1,
      files: [js.id, css.id],
      scripts: [{ fileId: js.id, position: 'body-end', loading: 'normal', pages: [] }],
      styles: [{ fileId: css.id, pages: [] }],
      native: [
        { kind: 'media', sourceId: mediaId, mediaId, variants: ['card'] },
        { kind: 'asset', sourceId: asset.assetId, assetId: asset.assetId },
      ],
    }
    await client.query('SELECT app.save_site_file_bundle($1,0,$2)', [g.site, JSON.stringify(nativeBundle)])
    await client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto(g.base + '/scripts')
    await expect(
      page.getByRole('heading', { name: 'Original image and document addresses', exact: true }),
    ).toBeVisible()
    await capture(
      page,
      'native-addresses-' + browserName,
      page.getByRole('heading', { name: 'Original image and document addresses', exact: true }),
    )
    await publishFiles(page)
    const sourcePage = await page.context().newPage()
    sourcePage.on('pageerror', error => errors.push(error.message))
    await sourcePage.goto(g.url)
    await expect(sourcePage.locator('html')).toHaveAttribute('data-native-image', 'loaded')
    await expect(sourcePage.locator('html')).toHaveAttribute('data-native-document', 'loaded')
    await sourcePage.close()
    async function archive(site: string) {
      await page.goto('/sites/' + site + '/settings')
      if (await page.getByRole('link', { name: 'Advanced', exact: true }).count())
        await page.getByRole('link', { name: 'Advanced', exact: true }).click()
      const promise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download content archive', exact: true }).click()
      return JSON.parse((await readFile((await (await promise).path())!)).toString())
    }
    async function copy(source: unknown, label: string) {
      const slug = 'native-copy-' + randomUUID().slice(0, 8),
        response = await page.request.post('/api/sites/import', {
          headers: { origin: `http://127.0.0.1:${E2E_PORTS.admin}` },
          data: {
            requestId: randomUUID(),
            destination: { slug, name: label },
            archive: source,
            reviewedSiteFiles: true,
          },
        })
      expect(response.status()).toBe(201)
      return { id: (await response.json()).siteId as string, host: slug + '.staging.localhost' }
    }
    async function publish(site: string) {
      await page.goto('/sites/' + site + '/publishing')
      await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
      const review = page.getByLabel('Selected changes review', { exact: true })
      await expect(review).toContainText('Site scripts and files')
      await review.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
      await expect(
        page.getByRole('status').filter({ hasText: 'Release applied. The selected changes took effect together.' }),
      ).toBeVisible()
    }
    const sourceArchive = await archive(g.site),
      first = await copy(sourceArchive, 'Native addresses first copy')
    expect((await rawRequest({ host: first.host, path: imagePath })).status).toBe(404)
    const copiedPage = (await client.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [first.id])).rows[0]!
        .id,
      copiedImage = (
        await client.query("SELECT id FROM media WHERE site_id=$1 AND original_name='original-image.png'", [first.id])
      ).rows[0]!.id
    const copiedPrivate = (
      await client.query("SELECT id FROM media WHERE site_id=$1 AND original_name='private-draft.png'", [first.id])
    ).rows[0]!.id
    expect(copiedImage).not.toBe(mediaId)
    expect(copiedPrivate).not.toBe(privateMediaId)
    await page.goto('/pages/' + copiedPage + '?site=draft')
    const frame = page.frameLocator('iframe[title="Page canvas"]')
    await expect(frame.locator('html')).toHaveAttribute('data-native-image', 'loaded')
    await expect(frame.locator('html')).toHaveAttribute('data-native-document', 'loaded')
    await expect(frame.getByRole('heading', { name: 'Approved script home', exact: true })).toBeVisible()
    await expect(frame.getByText('This content is complete before any JavaScript runs.', { exact: true })).toBeVisible()
    await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
    await capture(page, 'native-copy-private-editor-' + browserName)
    const ticketUrl = (await page.locator('iframe[title="Page canvas"]').getAttribute('src'))!,
      token = new URL(ticketUrl).pathname.split('/').at(-1)!
    expect((await rawRequest({ host: first.host, path: '/__cms/read/' + token + imagePath })).status).toBe(200)
    expect((await rawRequest({ host: first.host, path: '/__cms/read/' + token + pdfPath })).body).toBe(
      pdfBytes.toString(),
    )
    expect((await rawRequest({ host: g.host, path: '/__cms/read/' + token + imagePath })).status).toBe(404)
    expect(
      (await rawRequest({ host: first.host, path: '/__cms/read/' + token + '/media/' + copiedPrivate + '/card' }))
        .status,
    ).toBe(404)
    await publish(first.id)
    const mediaResponse = await page.request.get('/api/sites/' + first.id + '/media')
    expect(mediaResponse.status()).toBe(200)
    const mediaLibrary = await mediaResponse.json(),
      copiedAsset = mediaLibrary.assets.find((item: { id: string }) => item.id === copiedImage)
    expect(copiedAsset.usedOnItems).toBe(1)
    expect(copiedAsset.usedInVersions).toBe(1)
    expect(mediaLibrary.assets.find((item: { id: string }) => item.id === copiedPrivate).usedInVersions).toBe(0)
    await page.goto('/sites/' + first.id + '/media')
    await page.getByRole('button').filter({ hasText: 'original-image.png' }).click()
    const imageDetails = page.getByRole('dialog', { name: 'Image details', exact: true })
    await imageDetails.getByRole('tab', { name: 'Used on', exact: true }).click()
    await expect(imageDetails.getByRole('link', { name: 'Site interactions', exact: true })).toBeVisible()
    await expect(imageDetails).toContainText('Reviewed version 1')
    await capture(page, 'native-media-usage-' + browserName)
    await imageDetails.getByRole('button', { name: 'Close Image details', exact: true }).click()
    const publicPage = await page.context().newPage()
    publicPage.on('pageerror', error => errors.push(error.message))
    await publicPage.goto('http://' + first.host + `:${E2E_PORTS.site}`)
    await expect(publicPage.locator('html')).toHaveAttribute('data-native-image', 'loaded')
    await expect(publicPage.locator('html')).toHaveAttribute('data-native-document', 'loaded')
    await expect(publicPage.getByRole('heading', { name: 'Approved script home', exact: true })).toBeVisible()
    await expect(publicPage.locator('main')).toHaveCSS('background-image', new RegExp(mediaId))
    for (const width of [1440, 1024, 390]) {
      await publicPage.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await publicPage.screenshot({
        path: resolve(folder, 'native-copy-public-' + browserName + '-' + width + '.png'),
        scale: 'css',
      })
    }
    await publicPage.close()
    for (const path of [imagePath, pdfPath]) {
      expect((await rawRequest({ host: first.host, path })).status).toBe(200)
      expect((await rawRequest({ host: 'demo.staging.localhost', path })).status).toBe(404)
    }
    for (const path of [
      '/media/' + privateMediaId + '/card',
      '/media/' + copiedPrivate + '/card',
      '/media/' + copiedImage + '/original',
    ])
      expect((await rawRequest({ host: first.host, path })).status).toBe(404)
    expect((await rawRequest({ host: g.host, path: '/media/' + copiedImage + '/card' })).status).toBe(404)
    const copiedReceipt = (
        await client.query("SELECT object_key FROM media_variants WHERE media_id=$1 AND kind='card'", [copiedImage])
      ).rows[0]!,
      filePath = join(defaultMediaRoot(), copiedReceipt.object_key),
      stored = await readFile(filePath),
      changed = Buffer.from(stored)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1
    try {
      await writeFile(filePath, changed)
      expect((await rawRequest({ host: first.host, path: imagePath })).status).toBe(404)
      expect((await rawRequest({ host: first.host, path: imagePath, method: 'HEAD' })).status).toBe(404)
      expect((await rawRequest({ host: first.host, path: '/__cms/read/' + token + imagePath })).status).toBe(404)
    } finally {
      await writeFile(filePath, stored)
    }
    const second = await copy(await archive(first.id), 'Native addresses second copy')
    await publish(second.id)
    for (const path of [imagePath, '/media/' + copiedImage + '/card', pdfPath])
      expect((await rawRequest({ host: second.host, path })).status).toBe(200)
    for (const path of [
      '/media/' + privateMediaId + '/card',
      '/media/' + copiedPrivate + '/card',
      '/media/' + copiedImage + '/original',
    ])
      expect((await rawRequest({ host: second.host, path })).status).toBe(404)
    for (const target of [first, second]) {
      const originalAddress = '/site-files/' + scriptId + '/' + scriptHash + '/native-original.js'
      expect((await rawRequest({ host: target.host, path: originalAddress })).body).toBe(jsSource)
    }
    const filesPath = '/sites/' + first.id + '/scripts'
    await page.goto(filesPath)
    await page.getByRole('button', { name: 'Remove native-original.js', exact: true }).click()
    const refreshes: string[] = []
    const observeRefresh = (request: Request) => {
      const headers = request.headers()
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname === filesPath &&
        headers.rsc === '1' &&
        headers['next-router-prefetch'] !== '1'
      )
        refreshes.push(request.url())
    }
    page.on('request', observeRefresh)
    await approve(page)
    await page.goto('/pages/' + copiedPage + '?site=draft')
    page.off('request', observeRefresh)
    expect(refreshes).toEqual([])
    await expect(page.frameLocator('iframe[title="Page canvas"]').locator('main')).toHaveCSS(
      'background-image',
      /__cms\/read\/.+\/media\//,
    )
    await expect(page.frameLocator('iframe[title="Page canvas"]').locator('html')).not.toHaveAttribute(
      'data-native-image',
      'loaded',
    )
    await capture(page, 'native-css-only-editor-' + browserName)
    await page.goto('/sites/' + first.id + '/scripts')
    await publishFiles(page)
    const cssOnly = await rawRequest({ host: first.host, path: '/' })
    expect(cssOnly.body).not.toContain('native-original.js')
    expect(cssOnly.headers['content-security-policy']).toContain("default-src 'none'")
    expect(cssOnly.headers['content-security-policy']).not.toContain('script-src')
    expect((await rawRequest({ host: first.host, path: imagePath })).status).toBe(200)
    await page.goto('/sites/' + first.id + '/scripts')
    await page.getByRole('button', { name: 'Remove addresses for original-image.png', exact: true }).click()
    await page.getByRole('button', { name: 'Remove addresses for original-document.pdf', exact: true }).click()
    await page.getByRole('button', { name: 'Review file changes', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Removed original addresses:')
    await capture(page, 'native-removal-review-' + browserName)
    await page
      .getByRole('dialog')
      .getByRole('checkbox', { name: /I reviewed every file/ })
      .check()
    await page.getByRole('dialog').getByRole('button', { name: 'Save reviewed version', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await publishFiles(page)
    expect((await rawRequest({ host: first.host, path: imagePath })).status).toBe(404)
    expect((await rawRequest({ host: first.host, path: pdfPath })).status).toBe(404)
    expect((await rawRequest({ host: first.host, path: '/__cms/read/' + token + imagePath })).status).toBe(200)
    await client.query(
      "UPDATE canvas_preview_tickets SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
      [token],
    )
    expect((await rawRequest({ host: first.host, path: '/__cms/read/' + token + imagePath })).status).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await g.pool.end()
  }
})

test('reviewed original structure keeps source roots, plain document attributes and inline editing', async ({
  page,
  browser,
  browserName,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const g = await fixture(),
    client = await g.pool.connect(),
    errors: string[] = [],
    readonlyWarnings = new Set<string>()
  const watchConsole = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() !== 'error') return
    const warning = message
      .text()
      .match(
        new RegExp(
          String.raw`^Blocked script execution in '(http:\/\/127\.0\.0\.1:${E2E_PORTS.admin}\/preview\/[0-9a-f-]+\?readonly=1(?:&thumbnail=1)?)' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$`,
          '',
        ),
      )
    if (warning) {
      readonlyWarnings.add(warning[1]!)
      return
    }
    errors.push(message.text())
  }
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', watchConsole)
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const source =
        '<section id="source-section" class="source-layout"><h1>{{heading}}</h1><p>This source content is complete before JavaScript runs.</p><button id="source-toggle" type="button" aria-controls="source-panel">More information</button><div id="source-panel">Original disclosure content</div></section>',
      slug = 'original-proof-' + randomUUID().slice(0, 8),
      slots = [{ id: 'heading', kind: 'text' as const, label: 'Heading', constraints: {} }],
      compiled = compileSection({ sourceHtml: source, slots, scopeSelector: sectionScopeSelector(slug)! })
    expect(compiled.blocking).toEqual([])
    const def = (
      await client.query(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          slug,
          'Original source layout',
          'Imported',
          source,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Original layout proof',
          false,
          'legacy',
          null,
          null,
          'site',
          g.site,
        ],
      )
    ).rows[0]!
    const core = (
      await client.query(
        "SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-cta-band' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    const revision = (await client.query('SELECT revision FROM pages WHERE id=$1', [g.pages[0]])).rows[0]!.revision
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        g.pages[0],
        revision,
        JSON.stringify([
          {
            section_def_id: def.section_def_id,
            section_def_version: def.version,
            values: { heading: 'Original source page' },
            hidden: false,
            hidden_at: [],
            label: 'Original source',
          },
          {
            section_def_id: core.id,
            section_def_version: Number(core.version),
            values: {
              heading: 'New CMS section',
              intro: 'New sections keep their site theme beside the original content.',
              action: { label: 'New CMS action', url: '/other' },
            },
            hidden: false,
            hidden_at: [],
            label: 'New CMS section',
          },
        ]),
        JSON.stringify({ description: 'A proof of preserved original page structure.' }),
      ])
    ).rows[0]!
    await client.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [g.pages[0], saved.revision])
    const store = createFilesystemMediaStore(defaultMediaRoot()),
      js = await registerReviewedSiteFile({
        client,
        store,
        siteId: g.site,
        kind: 'script',
        name: 'original-structure.js',
        source: 'local:js/original-structure.js',
        bytes: Buffer.from(
          "document.documentElement.dataset.sourceReady='yes';const trigger=document.getElementById('source-toggle'),panel=document.getElementById('source-panel');panel.hidden=true;trigger.addEventListener('click',()=>{panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden))});",
        ),
      }),
      css = await registerReviewedSiteFile({
        client,
        store,
        siteId: g.site,
        kind: 'stylesheet',
        name: 'original-structure.css',
        source: 'local:css/original-structure.css',
        bytes: Buffer.from(
          'body{margin:0;font-family:system-ui;background:#faf8f4;color:#222}.source-layout{max-width:60rem;margin:0 auto;padding:2rem}.source-layout h1{font-size:2.5rem}.source-layout button{padding:.75rem 1rem;cursor:pointer}.source-layout button:hover{background:#ddeaf7}',
        ),
      })
    await client.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      g.site,
      JSON.stringify({
        version: 1,
        files: [js.id, css.id],
        scripts: [{ fileId: js.id, position: 'body-end', loading: 'normal', pages: [g.pages[0]] }],
        styles: [{ fileId: css.id, pages: [g.pages[0]] }],
        original: {
          version: 1,
          definitions: [{ section_def_id: def.section_def_id, section_def_version: def.version }],
          pages: [
            {
              pageId: g.pages[0],
              quirks: true,
              html: { lang: 'en', class: 'original-document' },
              body: { 'data-bs-spy': 'scroll', 'data-bs-target': '.fixed-top' },
              header: false,
              footer: false,
            },
          ],
        },
      }),
    ])
    await client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto(g.base + '/pages')
    await page.getByRole('link', { name: 'Approved script home', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/pages/' + g.pages[0] + '$'))
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Preview with saved menu & footer changes', exact: true }).check()
    await page.keyboard.press('Escape')
    const frame = page.frameLocator('iframe[title="Page canvas"]')
    await expect(frame.locator('html')).toHaveAttribute('data-source-ready', 'yes')
    await expect(frame.locator('body')).toHaveAttribute('data-bs-spy', 'scroll')
    await expect(frame.locator('#source-section')).toHaveAttribute('data-cms-section', '0')
    await expect(frame.locator('main#cms-main')).toHaveCount(0)
    await expect(frame.locator('#s0')).toHaveCount(0)
    expect(await frame.locator('html').evaluate(() => document.compatMode)).toBe('BackCompat')
    await frame.locator('#source-section [data-cms-slot="heading"]').click()
    await expect(frame.locator('#source-section [data-cms-slot="heading"]')).toHaveAttribute('data-cms-selected', '')
    await capture(page, 'original-structure-editor-' + browserName)
    await page.goto(g.base + '/scripts')
    await expect(page.getByRole('heading', { name: 'Original page layouts', exact: true })).toBeVisible()
    await expect(page.getByText(/Approved script home\s+· Original browser layout/)).toBeVisible()
    await capture(
      page,
      'original-structure-choices-' + browserName,
      page.getByRole('heading', { name: 'Original page layouts', exact: true }),
    )
    await publishFiles(page)
    const privateVersion = (await client.query('SELECT draft_version_id FROM pages WHERE id=$1', [g.pages[0]])).rows[0]!
        .draft_version_id,
      adminOrigin = new URL(page.url()).origin,
      readOnly = await page.context().newPage()
    readOnly.on('console', watchConsole)
    try {
      const response = await readOnly.goto(adminOrigin + '/preview/' + privateVersion + '?readonly=1')
      expect(response?.status()).toBe(200)
      const policy = response!.headers()['content-security-policy']!
      expect(policy).toContain(adminOrigin + '/site-files/')
      expect(policy).toContain("script-src 'none'")
      expect(policy).toContain('sandbox allow-same-origin')
      expect(await response!.text()).not.toMatch(/<script\b/i)
      await expect(readOnly.locator('#source-section h1')).toHaveCSS('font-size', '40px')
      expect(await readOnly.locator('html').getAttribute('data-source-ready')).toBeNull()
      await expect(readOnly.getByText('Original disclosure content', { exact: true })).toBeVisible()
      for (const width of [1440, 1024]) {
        await readOnly.setViewportSize({ width, height: 900 })
        await readOnly.screenshot({
          path: resolve(folder, 'original-structure-readonly-' + browserName + '-' + width + '.png'),
          animations: 'disabled',
        })
      }
    } finally {
      await readOnly.close()
    }
    const foreign = await browser.newContext()
    try {
      const outsider = await foreign.newPage()
      await signIn(outsider, 'contributor@example.test')
      expect(
        (
          await outsider.request.get(
            adminOrigin + '/site-files/' + css.id + '/' + css.sha256 + '/original-structure.css',
          )
        ).status(),
      ).toBe(404)
    } finally {
      await foreign.close()
    }
    const publicPage = await page.context().newPage()
    publicPage.on('pageerror', error => errors.push(error.message))
    publicPage.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await publicPage.goto(g.url)
    expect(await publicPage.evaluate(() => document.compatMode)).toBe('BackCompat')
    await expect(publicPage.locator('html')).toHaveAttribute('data-source-ready', 'yes')
    await expect(publicPage.locator('main')).toHaveCount(0)
    await expect(publicPage.locator('#source-section')).toHaveAttribute('class', 'source-layout')
    await expect(publicPage.locator('[data-cms-section]')).toHaveCount(0)
    const coreAction = publicPage.getByRole('link', { name: 'New CMS action', exact: true })
    await expect(coreAction).toHaveCSS('display', 'flex')
    await expect(coreAction).toHaveCSS('align-items', 'center')
    expect(
      await coreAction.evaluate(node => {
        const rect = node.getBoundingClientRect(),
          style = getComputedStyle(node)
        return rect.width >= 32 && rect.height >= 32 && parseFloat(style.paddingInlineStart) >= 8
      }),
    ).toBe(true)
    await expect(publicPage.locator('#source-section h1')).toHaveCSS('font-size', '40px')
    await publicPage.getByRole('button', { name: 'More information' }).click()
    await expect(publicPage.locator('#source-panel')).toBeVisible()
    await publicPage.getByRole('button', { name: 'More information' }).click()
    await expect(publicPage.locator('#source-panel')).toBeHidden()
    for (const width of [1440, 1024, 390]) {
      await publicPage.setViewportSize({ width, height: width === 1440 ? 900 : width === 1024 ? 768 : 844 })
      await publicPage.screenshot({
        path: resolve(folder, 'original-structure-public-' + browserName + '-' + width + '.png'),
        animations: 'disabled',
        scale: 'css',
      })
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await publicPage.goto(g.url + '/other')
    expect(await publicPage.evaluate(() => document.compatMode)).toBe('CSS1Compat')
    await expect(publicPage.locator('main#cms-main')).toHaveCount(1)
    expect(await publicPage.locator('html').getAttribute('data-source-ready')).toBeNull()
    await publicPage.close()
    const noJs = await browser.newContext({ javaScriptEnabled: false }),
      noJsPage = await noJs.newPage()
    noJsPage.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await noJsPage.goto(g.url)
    await expect(noJsPage.getByRole('heading', { name: 'Original source page' })).toBeVisible()
    await expect(noJsPage.getByText('Original disclosure content', { exact: true })).toBeVisible()
    await noJs.close()
    await page.goto(g.base + '/scripts')
    await page.getByRole('button', { name: 'Remove original page layouts', exact: true }).click()
    await page.getByRole('button', { name: 'Review file changes', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Review site file changes', exact: true })
    await expect(review).toContainText('Original page layouts will be removed.')
    await expect(review.getByRole('button', { name: 'Save reviewed version' })).toBeDisabled()
    await capture(page, 'original-structure-removal-' + browserName, review.getByRole('heading'))
    await review.getByRole('button', { name: 'Cancel', exact: true }).click()
    page.once('dialog', dialog => dialog.accept())
    await page.reload()
    const exported = await page.request.get('/api/sites/' + g.site + '/export')
    expect(exported.status()).toBe(200)
    const archive = await exported.json()
    archive.content.site_files = []
    archive.objects = archive.objects.filter((object: { kind: string }) => object.kind !== 'site-file')
    for (const version of archive.content.site_file_versions) {
      version.bundle.files = []
      version.bundle.scripts = []
      version.bundle.styles = []
      delete version.bundle.paths
      delete version.bundle.native
    }
    await page.goto('/sites/import')
    await page.getByLabel(/Content archive/).setInputFiles({
      name: 'original-without-files.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(archive)),
    })
    await page.getByLabel('New site name', { exact: true }).fill('Original layout without scripts')
    await page.getByLabel('New short address', { exact: true }).fill('original-no-files-' + randomUUID().slice(0, 8))
    await expect(page.getByRole('button', { name: 'Create private draft copy', exact: true })).toBeDisabled()
    await expect(page.getByText(/Original page layouts are included/)).toBeVisible()
    await capture(
      page,
      'original-structure-import-review-' + browserName,
      page.getByRole('heading', { name: 'Review original page layouts', exact: true }),
    )
    await page.getByRole('checkbox', { name: 'I reviewed the original page layouts.', exact: true }).check()
    await page.getByRole('button', { name: 'Create private draft copy', exact: true }).click()
    const link = page.getByRole('link', { name: 'Open imported site', exact: true })
    await expect(link).toBeVisible()
    const copyId = (await link.getAttribute('href'))!.split('/').at(-1)!,
      copyPage = (await client.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [copyId])).rows[0]!.id
    await page.goto('/pages/' + copyPage + '?site=draft')
    const copyFrame = page.frameLocator('iframe[title="Page canvas"]')
    await expect(copyFrame.locator('#source-section')).toHaveAttribute('data-cms-section', '0')
    await expect(copyFrame.locator('main#cms-main')).toHaveCount(0)
    await expect(copyFrame.getByRole('heading', { name: 'Original source page', exact: true })).toBeVisible()
    expect(await copyFrame.locator('html').getAttribute('data-source-ready')).toBeNull()
    await capture(page, 'original-structure-no-files-editor-' + browserName)
    for (const url of readonlyWarnings) {
      const response = await page.request.get(url)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
      expect(response.headers()['content-security-policy']).toContain('sandbox allow-same-origin')
      expect(await response.text()).not.toMatch(/<script\b/i)
    }
    expect(errors).toEqual([])
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await g.pool.end()
  }
})
