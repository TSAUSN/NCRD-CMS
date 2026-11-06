import { E2E_PORTS } from '../test-ports.ts'
import { compileSection, sectionScopeSelector } from '../../packages/renderer/src/index.ts'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Pool } from 'pg'
import { test, expect, type Page } from '@playwright/test'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
import { registerReviewedSiteFile } from '../../packages/platform/src/site-files.ts'
import { sectionStartingValues } from '../../packages/schema/src/content/source-samples.ts'
import { siteFileAddress } from '../../packages/schema/src/content/site-files.ts'
import { e2eTarget } from '../test-target.ts'
import { signIn, saveDraft } from './helpers.ts'
import { rawRequest } from './http.ts'
const readonlyWarnings = new WeakMap<string[], Set<string>>()
function watchErrors(page: Page): string[] {
  const errors: string[] = [],
    warnings = new Set<string>()
  readonlyWarnings.set(errors, warnings)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const warning = message
      .text()
      .match(
        new RegExp(
          String.raw`^Blocked script execution in '(http:\/\/127\.0\.0\.1:${E2E_PORTS.admin}\/preview\/[0-9a-f-]+\?readonly=1(?:&thumbnail=1)?)' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$`,
          '',
        ),
      )
    if (warning) warnings.add(warning[1]!)
    else errors.push(message.text())
  })
  return errors
}
async function expectNoErrors(page: Page, errors: string[]) {
  for (const url of readonlyWarnings.get(errors) ?? []) {
    const response = await page.request.get(url)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
    expect(response.headers()['content-security-policy']).toContain('sandbox allow-same-origin')
    expect(await response.text()).not.toMatch(/<script\b/i)
  }
  expect(errors).toEqual([])
}
const channel = 'isolated-canvas-proof-12345678'
async function fixture() {
  const target = e2eTarget(),
    pool = new Pool({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` }),
    client = await pool.connect()
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const suffix = randomUUID().slice(0, 8),
      host = `isolated-${suffix}.staging.localhost`
    const theme = (
      await client.query(
        "SELECT v.tokens FROM themes h JOIN sites s ON s.id=h.site_id JOIN theme_versions v ON v.id=h.published_version_id WHERE s.slug='demo'",
      )
    ).rows[0]!.tokens
    const site = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `isolated-${suffix}`,
        'Isolated private preview',
        'general',
        host,
        JSON.stringify(theme),
        '[]',
      ])
    ).rows[0]!.id
    const editor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await client.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, site])
    const page = (await client.query("SELECT app.create_page($1,'','Private carousel page') AS id", [site])).rows[0]!.id
    const def = (
      await client.query(
        "SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    const rich = (
      await client.query(
        "SELECT d.id,v.version,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-text-block' AND d.site_id IS NULL ORDER BY v.version DESC LIMIT 1",
      )
    ).rows[0]!
    const content = [
      {
        section_def_id: def.id,
        section_def_version: Number(def.version),
        values: { heading: 'Private carousel heading', intro: 'Complete server-rendered content.' },
        label: 'Hero',
      },
      {
        section_def_id: rich.id,
        section_def_version: Number(rich.version),
        values: sectionStartingValues(rich.slots),
        label: 'Story',
      },
    ]
    const faqSlug = 'proof-faq-' + suffix,
      faqHtml =
        '<section><h2>Questions</h2><input type="search" aria-label="Search questions" disabled data-cms-faq-filter><details class="faq-item"><summary>Alpha question</summary><p>Alpha answer.</p></details><details class="faq-item"><summary>Beta question</summary><p>Beta answer.</p></details></section>'
    const faq = compileSection({ sourceHtml: faqHtml, slots: [], scopeSelector: sectionScopeSelector(faqSlug)! })
    expect(faq.blocking).toEqual([])
    const faqDef = (
      await client.query(
        'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
        [
          faqSlug,
          'Questions',
          'Text',
          faqHtml,
          '',
          faq.css,
          JSON.stringify(faq.ast),
          '[]',
          faq.renderHash,
          faq.ast.policyVersion,
          faq.ast.cssPolicyVersion,
          'Fixed widget proof',
          false,
          'legacy',
          null,
          null,
          'site',
          site,
          0,
          null,
        ],
      )
    ).rows[0]!.section_def_id
    content.push({ section_def_id: faqDef, section_def_version: 1, values: {}, label: 'Questions' })
    const version = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [page, JSON.stringify(content), '{}'])
    ).rows[0]!.version_id
    const store = createFilesystemMediaStore(defaultMediaRoot())
    const add = (kind: 'script' | 'stylesheet' | 'font' | 'image' | 'data', name: string, bytes: Uint8Array) =>
      registerReviewedSiteFile({
        client,
        store,
        siteId: site,
        kind,
        name,
        source: 'local:isolated-proof/' + name,
        bytes,
      })
    const data = await add('data', 'items.json', Buffer.from('{"proof":"only this private page"}'))
    const image = await add(
      'image',
      'proof.svg',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="red"/></svg>',
      ),
    )
    const font = await add(
      'font',
      'open-sans.woff2',
      await readFile(resolve('../node_modules/@fontsource/open-sans/files/open-sans-latin-400-normal.woff2')),
    )
    const css = await add(
      'stylesheet',
      'proof.css',
      Buffer.from(
        `@font-face{font-family:CanvasProof;src:url("${siteFileAddress(font)}") format("woff2")}h1{font-family:CanvasProof,sans-serif}main{background-image:url("${siteFileAddress(image)}");background-repeat:no-repeat}h1:hover{opacity:.8;transition:opacity .2s}@keyframes proof{to{opacity:.5}}`,
      ),
    )
    const script = await add(
      'script',
      'proof.js',
      Buffer.from(
        `document.documentElement.dataset.originalScript='running';window.proofTicks=0;setInterval(()=>{window.proofTicks++;},80);fetch('${siteFileAddress(data)}').then(r=>r.json()).then(data=>document.documentElement.dataset.privateFetch=data.proof);const xhr=new XMLHttpRequest();xhr.open('GET','${siteFileAddress(data)}');xhr.onload=()=>document.documentElement.dataset.privateXhr=JSON.parse(xhr.responseText).proof;xhr.send();`,
      ),
    )
    const originalCss = await add(
      'stylesheet',
      'original.css',
      Buffer.from(
        '@font-face{font-family:MappedProof;src:url(../fonts/open-sans.woff2) format("woff2")}main{background-image:url(../images/proof.svg)}main p{font-family:MappedProof,sans-serif}',
      ),
    )
    const originalJs = await add(
      'script',
      'original-paths.js',
      Buffer.from(
        "fetch('js/items.json?source=relative').then(r=>r.json()).then(data=>document.documentElement.dataset.originalPathFetch=data.proof);const originalXhr=new XMLHttpRequest();originalXhr.open('GET','js/items.json?source=xhr');originalXhr.onload=()=>document.documentElement.dataset.originalPathXhr=JSON.parse(originalXhr.responseText).proof;originalXhr.send();",
      ),
    )
    const oldScriptAddress = `/site-files/${randomUUID()}/${script.sha256}/${script.name}`
    const paths = [
      { path: '/js/items.json', fileId: data.id },
      { path: '/images/proof.svg', fileId: image.id },
      { path: '/fonts/open-sans.woff2', fileId: font.id },
      { path: '/js/proof.js', fileId: script.id },
      { path: '/css/original.css', fileId: originalCss.id },
      { path: '/js/original-paths.js', fileId: originalJs.id },
      { path: oldScriptAddress, fileId: script.id },
    ]
    const unapproved = await add(
      'script',
      'not-approved.js',
      Buffer.from("document.documentElement.dataset.unapproved='wrong';"),
    )
    await client.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      site,
      JSON.stringify({
        version: 1,
        files: [data.id, image.id, font.id, css.id, script.id, originalCss.id, originalJs.id],
        scripts: [
          { fileId: script.id, position: 'body-end', loading: 'normal', pages: [] },
          { fileId: originalJs.id, position: 'body-end', loading: 'normal', pages: [] },
        ],
        styles: [
          { fileId: css.id, pages: [] },
          { fileId: originalCss.id, pages: [] },
        ],
        paths,
      }),
    ])
    const ticket = (
      await client.query('SELECT * FROM app.create_canvas_ticket($1,true,$2,$3,false,$4)', [
        version,
        `http://127.0.0.1:${E2E_PORTS.admin}`,
        channel,
        '[]',
      ])
    ).rows[0]!
    await client.query('COMMIT')
    return {
      pool,
      root,
      site,
      page,
      version,
      host,
      content,
      ticket: ticket.token as string,
      css,
      script,
      unapproved,
      data,
      image,
      font,
      originalCss,
      originalJs,
      paths,
      oldScriptAddress,
      url: `http://${host}:${E2E_PORTS.site}/__cms/canvas/${ticket.token}`,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    await pool.end()
    throw error
  } finally {
    client.release()
  }
}
let f: Awaited<ReturnType<typeof fixture>>
test.beforeAll(async () => {
  f = await fixture()
})
test.afterAll(async () => {
  await f?.pool.end()
})
test('isolated canvas runs reviewed scripts with private assets, exact CSP and no admin-origin access', async ({
  page,
  browserName,
  browser,
}) => {
  test.setTimeout(60_000)
  const errors = watchErrors(page)
  await signIn(page, 'root@example.test')
  const endpoint = '/api/pages/' + f.page + '/canvas'
  const origin = `http://127.0.0.1:${E2E_PORTS.admin}`
  const options = { action: 'open', versionId: f.version, sitePreview: 'draft', channel, showHidden: false }
  expect(
    (await page.request.post(endpoint, { headers: { origin: 'https://foreign.test' }, data: options })).status(),
  ).toBe(403)
  expect(
    (
      await page.request.post(endpoint, { headers: { origin }, data: { ...options, versionId: randomUUID() } })
    ).status(),
  ).toBe(404)
  const issued = await page.request.post(endpoint, { headers: { origin }, data: options })
  expect(issued.status()).toBe(200)
  const opened = await issued.json()
  expect(opened.href).toBe(`http://${f.host}:${E2E_PORTS.site}/__cms/canvas/${opened.token}`)
  expect(opened.token).toMatch(/^[a-f0-9]{64}$/)
  f.ticket = opened.token
  f.url = opened.href
  const renewed = await page.request.post(endpoint, { headers: { origin }, data: { action: 'renew', token: f.ticket } })
  expect(renewed.status()).toBe(200)
  expect(Date.parse((await renewed.json()).expiresAt)).toBeGreaterThanOrEqual(Date.parse(opened.expiresAt))
  const editorContext = await browser.newContext()
  try {
    const editor = await editorContext.newPage()
    await signIn(editor, 'editor@example.test')
    expect(
      (
        await editor.request.post(`http://127.0.0.1:${E2E_PORTS.admin}` + endpoint, {
          headers: { origin },
          data: { action: 'renew', token: f.ticket },
        })
      ).status(),
    ).toBe(404)
    const own = await editor.request.post(`http://127.0.0.1:${E2E_PORTS.admin}` + endpoint, {
      headers: { origin },
      data: options,
    })
    expect(own.status()).toBe(200)
    expect((await editor.request.get((await own.json()).href)).status()).toBe(200)
  } finally {
    await editorContext.close()
  }
  await page.goto('/pages/' + f.page)
  await page.evaluate(
    ({ url, channel }) => {
      ;(window as Window & { canvasMessages?: unknown[] }).canvasMessages = []
      window.addEventListener('message', event => {
        if (event.data?.channel === channel)
          (window as unknown as { canvasMessages: unknown[] }).canvasMessages.push(event.data)
      })
      const frame = document.createElement('iframe')
      frame.title = 'Isolated proof'
      frame.sandbox.add('allow-scripts', 'allow-same-origin')
      frame.src = url
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:white;z-index:2147483647'
      document.body.append(frame)
    },
    { url: f.url, channel },
  )
  const frame = page.frameLocator('iframe[title="Isolated proof"]')
  await expect(frame.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(frame.locator('html')).toHaveAttribute('data-private-fetch', 'only this private page')
  await expect(frame.locator('html')).toHaveAttribute('data-private-xhr', 'only this private page')
  await expect(frame.locator('html')).toHaveAttribute('data-original-path-fetch', 'only this private page')
  await expect(frame.locator('html')).toHaveAttribute('data-original-path-xhr', 'only this private page')
  await expect(frame.locator('h1')).toHaveText('Private carousel heading')
  expect(
    await frame.locator('html').evaluate(async () => {
      await document.fonts.ready
      return document.fonts.check('24px CanvasProof') && document.fonts.check('24px MappedProof')
    }),
  ).toBe(true)
  const css = await frame.locator('main').evaluate(node => getComputedStyle(node).backgroundImage)
  expect(css).toContain('/__cms/read/' + f.ticket)
  expect(
    await frame.locator('html').evaluate(() => {
      try {
        return Boolean(window.parent.document.body)
      } catch {
        return false
      }
    }),
  ).toBe(false)
  expect(await frame.locator('html').evaluate(() => document.cookie)).toBe('')
  await expect
    .poll(() => frame.locator('html').evaluate(() => (window as unknown as { proofTicks: number }).proofTicks))
    .toBeGreaterThan(1)
  await frame.locator('h1').click()
  const ticks = await frame.locator('html').evaluate(() => (window as unknown as { proofTicks: number }).proofTicks)
  const documentId = await frame.locator('html').getAttribute('data-cms-document')
  await page.evaluate(
    ({ origin, documentId }) =>
      document
        .querySelector<HTMLIFrameElement>('iframe[title="Isolated proof"]')!
        .contentWindow!.postMessage(
          { type: 'cms:set-selection', section: null, slot: null, channel: 'wrong-channel-123456', documentId },
          origin,
        ),
    { documentId, origin: `http://${f.host}:${E2E_PORTS.site}` },
  )
  await page.waitForTimeout(260)
  expect(await frame.locator('html').evaluate(() => (window as unknown as { proofTicks: number }).proofTicks)).toBe(
    ticks,
  )
  await page.evaluate(
    ({ channel, origin, documentId }) =>
      document
        .querySelector<HTMLIFrameElement>('iframe[title="Isolated proof"]')!
        .contentWindow!.postMessage(
          { type: 'cms:set-selection', section: null, slot: null, channel, documentId },
          origin,
        ),
    { channel, documentId, origin: `http://${f.host}:${E2E_PORTS.site}` },
  )
  await expect
    .poll(() => frame.locator('html').evaluate(() => (window as unknown as { proofTicks: number }).proofTicks))
    .toBeGreaterThan(ticks)
  // Real shared controls run in the child, with exact peer/document checks.
  const post = async (detail: Record<string, unknown>) =>
    page.evaluate(
      ({ detail, channel, documentId, origin }) =>
        document
          .querySelector<HTMLIFrameElement>('iframe[title="Isolated proof"]')!
          .contentWindow!.postMessage({ ...detail, channel, documentId }, origin),
      { detail, channel, documentId, origin: `http://${f.host}:${E2E_PORTS.site}` },
    )
  const controls = {
    sections: f.content.map(section => ({
      id: section.section_def_id,
      version: section.section_def_version,
      label: section.label,
      hidden: false,
      fields: [],
      values: {},
    })),
    selected: 0,
    slot: null,
    listItem: null,
    scale: 1,
    canReset: false,
  }
  await post({ type: 'cms:canvas-controls', controls })
  const insert = frame.getByRole('button', { name: 'Add section at start of page', exact: true })
  await expect(insert).toBeVisible()
  expect(await insert.evaluate(node => Number.parseFloat(getComputedStyle(node).minHeight))).toBeGreaterThanOrEqual(32)
  // Firefox's transformed rectangle can report32px as31.999996. Keep the32px
  // CSS minimum and screen-size checks, at sub-layout-unit measurement precision.
  expect(Number((await insert.boundingBox())!.height.toFixed(4))).toBeGreaterThanOrEqual(32)
  await insert.click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { canvasMessages: { type: string; at?: number }[] }).canvasMessages
          .filter(m => m.type === 'cms:add-section')
          .map(m => m.at),
      ),
    )
    .toEqual([0])
  // Shared TipTap model, closed formatting commands, final-value flush.
  const richField = {
    section: 1,
    slot: 'body',
    occurrence: 0,
    value: String(f.content[1]!.values.body),
    label: 'Story',
    disabled: false,
    x: null,
    y: null,
    constraints: {},
  }
  await post({ type: 'cms:rich-field', field: richField })
  const richEditor = frame.getByRole('textbox', { name: 'Story', exact: true })
  await expect(richEditor).toBeVisible()
  await richEditor.fill('Words inside the original page')
  await richEditor.press('ControlOrMeta+a')
  await post({ type: 'cms:rich-command', command: { type: 'bold' } })
  await expect(richEditor.locator('strong')).toHaveText('Words inside the original page')
  await post({ type: 'cms:flush-fields', request: 'proof-flush' })
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { canvasMessages: { type: string; value?: string; request?: string }[] }).canvasMessages
          .filter(m => m.type === 'cms:rich-value' || m.type === 'cms:fields-flushed')
          .slice(-2),
      ),
    )
    .toEqual([
      {
        type: 'cms:rich-value',
        section: 1,
        slot: 'body',
        value: '<p><strong>Words inside the original page</strong></p>',
        channel,
        documentId,
      },
      { type: 'cms:fields-flushed', request: 'proof-flush', channel, documentId },
    ])
  await post({ type: 'cms:rich-field', field: null })
  await expect(richEditor).toHaveCount(0)
  await frame.locator('html').evaluate(() => window.scrollTo(0, 0))
  const folder = resolve('../.r8-progress/step-5/isolated-canvas')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect
      .poll(() =>
        frame.locator('html').evaluate(() => {
          const section = document.querySelector('[data-cms-section="2"]')!.getBoundingClientRect(),
            button = [...document.querySelectorAll('button')]
              .find(node => node.getAttribute('aria-label') === 'Add section after Story')!
              .getBoundingClientRect()
          return Math.abs(section.top - button.top)
        }),
      )
      .toBeLessThan(2)
    await page.screenshot({
      path: join(folder, `${browserName}-private-canvas-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  const response = await rawRequest({ host: f.host, path: '/__cms/canvas/' + f.ticket })
  expect(response.status).toBe(200)
  expect(response.headers['cache-control']).toBe('private, no-store')
  expect(response.headers['referrer-policy']).toBe('no-referrer')
  const csp = response.headers['content-security-policy']!
  expect(csp).toContain(`frame-ancestors http://127.0.0.1:${E2E_PORTS.admin}`)
  expect(csp).not.toContain("script-src 'self'")
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  expect(response.body).not.toContain('<script>')
  expect(response.body).toContain('integrity="sha256-')
  expect(response.body).not.toContain(siteFileAddress(f.unapproved))
  for (const file of [f.script, f.css, f.font, f.image, f.data, f.originalCss, f.originalJs]) {
    const privateFile = await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + siteFileAddress(file) })
    expect(privateFile.status).toBe(200)
    expect(privateFile.headers['cache-control']).toBe('private, no-store')
    expect((await rawRequest({ host: f.host, path: siteFileAddress(file) })).status).toBe(404)
  }
  for (const mapped of f.paths) {
    expect((await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + mapped.path })).status).toBe(200)
    expect((await rawRequest({ host: f.host, path: mapped.path })).status).toBe(404)
    expect(
      (await rawRequest({ host: 'demo.staging.localhost', path: '/__cms/read/' + f.ticket + mapped.path })).status,
    ).toBe(404)
  }
  expect((await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + '/js/guessed.js' })).status).toBe(404)
  expect(
    (await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + siteFileAddress(f.unapproved) })).status,
  ).toBe(404)
  expect(
    (await rawRequest({ host: 'demo.staging.localhost', path: '/__cms/read/' + f.ticket + siteFileAddress(f.script) }))
      .status,
  ).toBe(404)
  expect((await rawRequest({ host: f.host, path: '/__cms/canvas/' + 'b'.repeat(64) })).status).toBe(404)
  const receipt = (await f.pool.query('SELECT object_key FROM site_files WHERE id=$1', [f.script.id])).rows[0]!,
    path = join(defaultMediaRoot(), receipt.object_key),
    original = await readFile(path)
  try {
    await writeFile(path, 'tampered')
    expect(
      (await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + siteFileAddress(f.script) })).status,
    ).toBe(404)
    expect((await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + '/js/proof.js' })).status).toBe(404)
    expect((await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + f.oldScriptAddress })).status).toBe(404)
  } finally {
    await writeFile(path, original)
  }
  await expectNoErrors(page, errors)
  const noJS = await browser.newContext({ javaScriptEnabled: false })
  try {
    const content = await noJS.newPage()
    await content.goto(f.url)
    await expect(content.locator('h1')).toHaveText('Private carousel heading')
    await expect(content.locator('html')).not.toHaveAttribute('data-original-script', 'running')
  } finally {
    await noJS.close()
  }
  const head = await page.request.head(f.url)
  expect(head.status()).toBe(200)
  await f.pool.query(
    "UPDATE canvas_preview_tickets SET created_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes' WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
    [f.ticket],
  )
  expect((await rawRequest({ host: f.host, path: '/__cms/canvas/' + f.ticket })).status).toBe(404)
  expect((await rawRequest({ host: f.host, path: '/__cms/read/' + f.ticket + siteFileAddress(f.script) })).status).toBe(
    404,
  )
})

test('the isolated page editor saves direct text and rich text, keeps final values through Duplicate and page Undo, and renews its preview', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000)
  const errors = watchErrors(page)
  await signIn(page, 'root@example.test')
  await page.goto('/pages/' + f.page)
  const canvas = page.frameLocator('iframe[title="Page canvas"]')
  await expect(canvas.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
  expect(
    await canvas.locator('html').evaluate(() => {
      try {
        return Boolean(parent.document.body)
      } catch {
        return false
      }
    }),
  ).toBe(false)
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'cms:command-search' }, origin: location.origin }),
    ),
  )
  await expect(page.getByRole('dialog', { name: 'Search or jump to', exact: true })).toHaveCount(0)
  await canvas.locator('h1').press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Search or jump to', exact: true }).getByRole('combobox')).toBeFocused()
  await page.keyboard.press('Escape')
  const heading = canvas.locator('[data-cms-section="0"] [data-cms-slot="heading"]').first()
  await heading.click()
  await heading.click()
  await heading.fill('Final typed words survive Duplicate')
  await page.getByRole('complementary', { name: 'Page structure' }).locator('.tree-label').first().click()
  await page.getByRole('button', { name: 'Duplicate section', exact: true }).click()
  await expect(canvas.locator('[data-cms-section="1"] [data-cms-slot="heading"]').first()).toHaveText(
    'Final typed words survive Duplicate',
  )
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(canvas.locator('[data-cms-section]')).toHaveCount(3)
  await expect(canvas.locator('h1')).toHaveText('Final typed words survive Duplicate')
  await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
  const body = canvas.locator('[data-cms-section="1"] [data-cms-slot="body"]').first()
  await body.click()
  await body.click()
  await expect(body).toHaveAttribute('contenteditable', 'true')
  await body.fill('Rich text is still directly editable')
  await body.press('ControlOrMeta+a')
  await page
    .getByRole('toolbar', { name: 'Canvas rich text formatting' })
    .getByRole('button', { name: 'Bold', exact: true })
    .click()
  await expect(body.locator('strong')).toHaveText('Rich text is still directly editable')
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await saveDraft(page)
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
  await page.reload()
  await expect(canvas.locator('h1')).toHaveText('Final typed words survive Duplicate')
  await expect(canvas.locator('[data-cms-section="1"] [data-cms-slot="body"] strong')).toHaveText(
    'Rich text is still directly editable',
  )
  // A site script may reload only its frame. A fresh readiness challenge
  // reconnects that document and patches the current unsaved editor values.
  await canvas.locator('h1').click()
  await page.locator('#slot-0-heading').fill('Text survives a frame reload')
  await expect(canvas.locator('h1')).toHaveText('Text survives a frame reload')
  const previousDocument = await canvas.locator('html').getAttribute('data-cms-document')
  await canvas.locator('html').evaluate(() => {
    window.setTimeout(() => location.reload(), 0)
  })
  await expect.poll(() => canvas.locator('html').getAttribute('data-cms-document')).not.toBe(previousDocument)
  await expect(canvas.getByRole('button', { name: 'Add section at start of page', exact: true })).toHaveCount(0)
  await expect(
    page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: 'Add at end', exact: true }),
  ).toBeVisible()
  await expect(canvas.locator('h1')).toHaveText('Text survives a frame reload')
  expect(previousDocument).toBeTruthy()
  await canvas.locator('html').evaluate((node, oldDocument) => {
    const origin = node.getAttribute('data-cms-parent-origin')!,
      channel = node.getAttribute('data-cms-channel')
    parent.postMessage(
      {
        type: 'cms:edit',
        section: 0,
        slot: 'heading',
        value: 'A stale frame cannot overwrite this',
        channel,
        documentId: oldDocument,
      },
      origin,
    )
    parent.postMessage(
      { type: 'cms:select', section: 0, slot: 'intro', channel, documentId: node.getAttribute('data-cms-document') },
      origin,
    )
  }, previousDocument)
  await expect(canvas.locator('[data-cms-slot="intro"][data-cms-selected]')).toBeAttached()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Text survives a frame reload')
  await saveDraft(page)
  // Visitor preview runs original scripts and fixed widgets on the public
  // origin, without any editor markup/model or an admin opener/cookie.
  const popupReady = page.context().waitForEvent('page', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await page.getByRole('button', { name: 'Open preview', exact: true }).click()
  const visitor = await popupReady
  visitor.on('pageerror', error => errors.push(error.message))
  visitor.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await visitor.waitForURL(/\/__cms\/canvas\/[a-f0-9]{64}\?visit=1$/)
  expect(new URL(visitor.url()).origin).toBe(`http://${f.host}:${E2E_PORTS.site}`)
  await expect(visitor.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(visitor.locator('h1')).toHaveText('Text survives a frame reload')
  await expect(visitor.locator('[data-cms-slot],[data-cms-section],cms-editor-layer')).toHaveCount(0)
  await expect(visitor.locator('script[src$="/editor/preview.js"]')).toHaveCount(0)
  expect(await visitor.evaluate(() => window.opener === null && document.cookie === '')).toBe(true)
  const search = visitor.getByRole('searchbox', { name: 'Search questions', exact: true })
  await expect(search).toBeEnabled()
  await search.fill('Beta')
  await expect(visitor.getByText('Alpha question', { exact: true })).toBeHidden()
  await expect(visitor.getByText('Beta question', { exact: true })).toBeVisible()
  await visitor.getByText('Beta question', { exact: true }).click()
  await expect(visitor.getByText('Beta answer.', { exact: true })).toBeVisible()
  await search.fill('')
  const visitorFolder = resolve('../.r8-progress/step-5/visitor-preview')
  await mkdir(visitorFolder, { recursive: true })
  for (const width of [1440, 1024, 390]) {
    await visitor.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await visitor.evaluate(() => document.fonts.ready)
    await visitor.screenshot({
      path: join(visitorFolder, `${browserName}-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  expect((await visitor.content()).match(/<script(?! [^>]*src=)[^>]*>/g)).toBeNull()
  const visitorToken = new URL(visitor.url()).pathname.split('/').at(-1)!
  const renewedVisitor = page.waitForResponse(
    response =>
      response.url().endsWith('/canvas') &&
      response.request().postDataJSON()?.action === 'renew' &&
      response.request().postDataJSON()?.token === visitorToken,
  )
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  expect((await renewedVisitor).status()).toBe(200)
  await visitor.reload()
  await expect(visitor.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(visitor.getByRole('searchbox', { name: 'Search questions', exact: true })).toBeEnabled()
  await visitor.close()
  // The live editor remains functional at both supported workspace widths.
  const folder = resolve('../.r8-progress/step-5/isolated-editor')
  await mkdir(folder, { recursive: true })
  const settledControls = async () => {
    const label = (await page
      .getByRole('complementary', { name: 'Page structure' })
      .locator('.tree-label')
      .first()
      .getAttribute('aria-label'))!
    await expect(canvas.locator('[data-cms-section="0"]')).toHaveAttribute('data-cms-label', label)
    await expect(canvas.getByRole('button', { name: 'Add section at start of page', exact: true })).toHaveCount(0)
  }
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    if (width === 1024) await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await page.getByRole('complementary', { name: 'Page structure' }).locator('.tree-label').first().click()
    if (width === 1024) await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await expect(page.getByRole('toolbar', { name: 'Selected section actions' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add section at start of page', exact: true })).toHaveCount(0)
    await expect(
      page
        .getByRole('complementary', { name: 'Page structure' })
        .getByRole('button', { name: 'Add at end', exact: true }),
    ).toBeVisible()
    await settledControls()
    await page.screenshot({
      path: join(folder, `${browserName}-editor-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect.poll(() => canvas.locator('html').evaluate(() => innerWidth)).toBe(390)
    await settledControls()
    await page.screenshot({
      path: join(folder, `${browserName}-phone-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  // Native insertion stays outside page content, including at manual zoom.
  for (const zoom of ['Zoom out', 'Zoom in']) {
    await page.getByRole('button', { name: zoom, exact: true }).click()
    await expect(canvas.getByRole('button', { name: 'Add section at start of page', exact: true })).toHaveCount(0)
  }
  await page
    .getByRole('complementary', { name: 'Page structure' })
    .getByRole('button', { name: 'Add at end', exact: true })
    .click()
  const library = page.getByRole('dialog', { name: /^Add a section/ })
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: 'Back', exact: true }).click()
  await saveDraft(page)
  await page.context().clearCookies()
  await signIn(page, 'editor@example.test')
  await page.goto('/pages/' + f.page)
  await expect(canvas.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(page.getByRole('button', { name: 'Add at end', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Duplicate section', exact: true })).toHaveCount(0)
  await canvas.locator('[data-cms-frame="header"]').click()
  const siteLook = page.getByRole('complementary', { name: 'Site-wide settings' })
  await expect(siteLook).toContainText('on all 1 page')
  await expect(siteLook.getByRole('button', { name: 'Edit header', exact: true })).toHaveCount(0)
  await expect(siteLook.getByRole('link', { name: 'Open Header & menu', exact: true })).toHaveCount(0)
  await expect(siteLook).toContainText('A Site admin can change this shared area.')
  await expect(canvas.getByLabel('Add page to menu', { exact: true })).toHaveCount(0)
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect(siteLook).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true)
    await page.screenshot({
      path: join(folder, `${browserName}-shared-note-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  await siteLook.getByRole('button', { name: 'Done', exact: true }).click()
  // Renew through the real session when the tab becomes visible again.
  let renewals = 0
  page.on('request', request => {
    if (request.url().endsWith('/canvas') && request.postDataJSON()?.action === 'renew') renewals++
  })
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => renewals).toBeGreaterThan(0)
  await expectNoErrors(page, errors)
})

test('an unavailable isolated preview keeps inspector edits saveable and recovers without losing them', async ({
  page,
  browserName,
}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'editor@example.test')
  let fail = true
  await page.route('**/api/pages/' + f.page + '/canvas', async route => {
    if (fail && route.request().postDataJSON()?.action === 'open') {
      fail = false
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporarily unavailable' }),
      })
      return
    }
    await route.continue()
  })
  await page.goto('/pages/' + f.page + '?section=0&field=heading')
  const alert = page.getByRole('tabpanel', { name: 'Page', exact: true }).getByRole('alert')
  await expect(alert).toContainText('The page preview could not be opened.')
  await page.locator('#slot-0-heading').fill('Keep this draft through preview recovery')
  await saveDraft(page)
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
  const folder = resolve('../.r8-progress/step-5/isolated-editor')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect(page.getByRole('button', { name: 'Reload preview', exact: true })).toBeVisible()
    await page.screenshot({
      path: join(folder, `${browserName}-error-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  await page.getByRole('button', { name: 'Reload preview', exact: true }).click()
  const frame = page.frameLocator('iframe[title="Page canvas"]')
  await expect(frame.locator('h1')).toHaveText('Keep this draft through preview recovery')
  await expect(alert).toHaveCount(0)
  await expect(page.locator('#slot-0-heading')).toHaveValue('Keep this draft through preview recovery')
  await expectNoErrors(page, errors)
})

test('Site look runs isolated scripts with unsaved style choices and site-level frame links, renews them and preserves saved content', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000)
  const errors = watchErrors(page)
  await signIn(page, 'root@example.test')
  await page.goto('/sites/' + f.site + '/design')
  const frame = page.frameLocator('iframe[title="Site look page preview"]'),
    folder = resolve('../.r8-progress/step-5/site-look-scripted')
  await mkdir(folder, { recursive: true })
  async function captureLook(state: string) {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await expect(page.getByText('Updating site preview…', { exact: true })).toHaveCount(0)
      await expect
        .poll(() =>
          page.locator('iframe[title="Site look page preview"]').evaluate(node => {
            const host = node.closest('[aria-label="Real site preview"]')!,
              style = getComputedStyle(host),
              available = host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
              box = node.getBoundingClientRect()
            return (
              Math.abs(box.width - Math.min(node.clientWidth, available)) < 1 &&
              box.right <= host.getBoundingClientRect().right + 1
            )
          }),
        )
        .toBe(true)
      await frame
        .locator('html')
        .evaluate(() =>
          document.fonts.ready.then(
            () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
          ),
        )
      if (state === 'footer') {
        const metrics = {
          source: await frame.locator('footer').evaluate(node => ({
            top: node.getBoundingClientRect().top,
            bottom: node.getBoundingClientRect().bottom,
            innerHeight,
            scrollY,
            height: document.documentElement.scrollHeight,
          })),
          frame: await page.locator('iframe[title="Site look page preview"]').boundingBox(),
          footer: await frame.locator('footer').boundingBox(),
          host: await page.getByLabel('Real site preview', { exact: true }).boundingBox(),
        }
        await test
          .info()
          .attach(`footer-bounds-${width}.json`, { body: JSON.stringify(metrics), contentType: 'application/json' })
        await expect
          .poll(async () => {
            const footer = await frame.locator('footer').boundingBox(),
              host = await page.getByLabel('Real site preview', { exact: true }).boundingBox()
            return Boolean(
              footer && host && footer.y >= host.y - 1 && footer.y + footer.height <= host.y + host.height + 1,
            )
          })
          .toBe(true)
      }
      await page.screenshot({
        path: join(folder, `${browserName}-${state}-${width}.png`),
        animations: 'disabled',
        scale: 'css',
      })
    }
  }
  const saved = (await f.pool.query('SELECT revision FROM themes WHERE site_id=$1', [f.site])).rows[0]!.revision
  await expect(frame.locator('html')).toHaveAttribute('data-original-script', 'running')
  expect(
    await frame.locator('html').evaluate(() => {
      try {
        return Boolean(parent.document.body)
      } catch {
        return false
      }
    }),
  ).toBe(false)
  await expect(frame.locator('[data-cms-section],cms-editor-layer')).toHaveCount(0)
  const brand = page.getByLabel('Brand', { exact: true })
  await brand.fill('#123456')
  await expect
    .poll(() =>
      frame
        .locator('html')
        .evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()),
    )
    .toBe('#123456')
  expect((await f.pool.query('SELECT revision FROM themes WHERE site_id=$1', [f.site])).rows[0]!.revision).toBe(saved)
  await captureLook('style')
  await expect(page.getByRole('complementary', { name: 'Site-wide settings', exact: true })).toHaveCount(0)
  const controls = page.getByRole('group', { name: 'Site look controls', exact: true })
  await expect(controls.getByRole('link', { name: 'Header & menu', exact: true })).toHaveAttribute(
    'href',
    '/sites/' + f.site + '/header',
  )
  await expect(controls.getByRole('link', { name: 'Footer', exact: true })).toHaveAttribute(
    'href',
    '/sites/' + f.site + '/footer',
  )
  await expect(page.getByLabel('Site name', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publish site look', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect.poll(() => frame.locator('html').evaluate(() => innerWidth)).toBe(390)
  await captureLook('phone')
  const token = await page
    .locator('iframe[title="Site look page preview"]')
    .getAttribute('src')
    .then(src => new URL(src!).pathname.split('/').at(-1)!)
  const renewed = page.waitForResponse(
    response =>
      response.url().endsWith('/canvas') &&
      response.request().postDataJSON()?.action === 'renew' &&
      response.request().postDataJSON()?.token === token,
  )
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  expect((await renewed).status()).toBe(200)
  const denied = await page.request.post(`/api/sites/${f.site}/global-elements/preview`, {
    headers: { Origin: 'https://foreign.invalid' },
    data: { isolated: true, channel },
  })
  expect(denied.status()).toBe(403)
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await expect(frame.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(page.getByLabel('Site name', { exact: true })).toHaveCount(0)
  expect(await brand.inputValue()).not.toBe('#123456')
  await expectNoErrors(page, errors)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in/)
  await signIn(page, 'editor@example.test')
  await page.goto('/sites/' + f.site + '/design')
  await expect(page.getByLabel('Brand', { exact: true })).toBeDisabled()
  await expect(frame.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(
    page
      .getByRole('group', { name: 'Site look controls', exact: true })
      .getByRole('link', { name: 'Header & menu', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByLabel('Site name', { exact: true })).toHaveCount(0)
  await captureLook('editor')
  await expectNoErrors(page, errors)
})

test('a failed scripted Site look preview keeps unsaved choices and retries safely', async ({ page, browserName }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'root@example.test')
  let fail = false
  await page.route(`**/api/sites/${f.site}/global-elements/preview`, async route => {
    if (fail && route.request().postDataJSON()?.isolated === true) {
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' })
      return
    }
    await route.continue()
  })
  await page.goto('/sites/' + f.site + '/design')
  const frame = page.frameLocator('iframe[title="Site look page preview"]')
  await expect(frame.locator('html')).toHaveAttribute('data-original-script', 'running')
  fail = true
  await page.getByLabel('Brand', { exact: true }).fill('#123456')
  const alert = page.getByLabel('Real site preview', { exact: true }).getByRole('alert')
  await expect(alert).toContainText('Your choices are still here.')
  const folder = resolve('../.r8-progress/step-5/site-look-scripted')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#123456')
    await page.screenshot({
      path: join(folder, `${browserName}-error-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  fail = false
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await expect
    .poll(() =>
      frame
        .locator('html')
        .evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()),
    )
    .toBe('#123456')
  await expect(frame.locator('html')).toHaveAttribute('data-original-script', 'running')
  await expect(alert).toHaveCount(0)
  await expectNoErrors(page, errors)
})
