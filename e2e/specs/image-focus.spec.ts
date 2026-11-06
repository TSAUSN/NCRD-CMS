import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { e2eTarget } from '../test-target.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
const run = promisify(execFile)
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn, canvas, saveDraft, publish } from './helpers.ts'
import { rawRequest } from './http.ts'
import { LOCAL_BRAND_FONTS } from '@cms/renderer'
test.use({ actionTimeout: 15_000 })
test('picture focus drags once into page history, previews crops and publishes only the saved placement', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)
  const f = await echelonFixture(),
    home = f.pages.find(row => row.slug === '')!.id,
    folder = resolve('../.r8-progress/echelon/focus'),
    errors: string[] = []
  let provokedImageFailure = false,
    mediaId = ''
  let objects: string[] = []
  const readonlyWarnings = new Set<string>()
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
    if (warning) {
      readonlyWarnings.add(warning[1]!)
      return
    }
    if (!(provokedImageFailure && message.text().startsWith('Failed to load resource:'))) errors.push(message.text())
  })
  const capture = async (name: string) => {
    const precision = page.getByRole('group', { name: 'Focus point', exact: true }).locator('details'),
      wasOpen = (await precision.getAttribute('open')) !== null
    if (wasOpen) await precision.locator('summary').click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    if (wasOpen) await precision.locator('summary').click()
  }
  try {
    await mkdir(folder, { recursive: true })
    const target = e2eTarget(),
      foreign = (await f.pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const { stdout } = await run(
      process.execPath,
      [
        '--conditions=react-server',
        '--experimental-strip-types',
        '--no-warnings',
        'e2e/fixtures/echelon-media-runner.ts',
        f.actor,
        f.site,
        foreign,
      ],
      {
        cwd: resolve('..'),
        env: {
          ...process.env,
          CMS_LOCAL_TEST_MODE: 'true',
          MEDIA_PROVIDER: 'filesystem',
          MEDIA_ROOT: defaultMediaRoot(),
          ADMIN_ORIGIN: `http://127.0.0.1:${E2E_PORTS.admin}`,
          DATABASE_URL: `postgres://cms:cms@${target.host}:${target.port}/${target.database}`,
          DATABASE_URL_AUTHENTICATED: `postgres://cms_admin_app:devpassword@${target.host}:${target.port}/${target.database}`,
          DATABASE_URL_WORKER: `postgres://cms_worker_app:devpassword@${target.host}:${target.port}/${target.database}`,
        },
        maxBuffer: 1024 * 1024,
      },
    )
    const imported = JSON.parse(stdout.trim().split('\n').at(-1)!)
    mediaId = imported.mediaId
    objects = imported.objects
    // Publish only governed images; generic starter artwork remains private.
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const starters = (
      await f.client.query(
        'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1',
        [f.site],
      )
    ).rows
    for (const starter of starters) {
      let changed = false
      const content = starter.content.map((section: { values: Record<string, unknown> }, sectionIndex: number) => ({
        ...section,
        values: Object.fromEntries(
          Object.entries(section.values).map(([key, value]) => {
            if (
              !(starter.id === home && sectionIndex === 0 && key === 'photo') &&
              value &&
              typeof value === 'object' &&
              'src' in value &&
              typeof value.src === 'string' &&
              value.src.startsWith('/cms-samples/')
            ) {
              changed = true
              return [
                key,
                {
                  media_id: mediaId,
                  variant: 'wide',
                  src: '/media/' + mediaId + '/wide',
                  alt: '[Reference photo description]',
                  decorative: false,
                },
              ]
            }
            return [key, value]
          }),
        ),
      }))
      if (changed)
        await f.client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          starter.id,
          starter.revision,
          JSON.stringify(content),
          JSON.stringify(starter.meta),
        ])
    }
    await f.client.query('COMMIT')
    for (const font of LOCAL_BRAND_FONTS) {
      const response = await page.request.get('/__cms/fonts/' + font.file)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toBe('font/woff2')
      expect((await response.body()).length).toBe(font.bytes)
    }
    expect((await page.request.get('/__cms/fonts/not-approved.woff2')).status()).toBe(404)
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + home + '?section=0')
    await page.getByRole('button', { name: 'Choose from media library', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByRole('option', { name: /\[Reference photo\]\.png/ }).click()
    await picker.getByRole('button', { name: 'Use this image', exact: true }).click()
    await page
      .getByRole('group', { name: 'Focus point', exact: true })
      .getByRole('button', { name: 'Use automatic crop', exact: true })
      .click()
    await saveDraft(page)
    await page.goto('/sites/' + f.site + '/publishing')
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const original = (await rawRequest({ host: f.hostname, path: '/' })).body
    await page.goto('/pages/' + home)
    const hero = canvas(page).locator('[data-cms-section="0"] img').first()
    await expect(hero).toBeVisible()
    await hero.click()
    const focus = page.getByRole('group', { name: 'Focus point', exact: true }),
      dot = focus.getByRole('button', { name: 'Choose focus point on image', exact: true }),
      across = focus.getByRole('slider', { name: 'Across', exact: true }),
      down = focus.getByRole('slider', { name: 'Down', exact: true })
    await expect(dot).toBeVisible()
    await focus.locator('summary').click()
    await expect(focus.getByRole('img', { name: /crop preview$/ })).toHaveCount(3)
    await capture('automatic')
    const box = await dot.locator('img').boundingBox()
    expect(box).toBeTruthy()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.4)
    await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.25)
    await page.mouse.up()
    await expect(across).toHaveValue('0.75')
    await expect(down).toHaveValue('0.25')
    await expect(hero).toHaveCSS('object-position', '75% 25%')
    for (const label of ['Card', 'Phone', 'Wide'])
      await expect(focus.getByRole('img', { name: label + ' crop preview', exact: true })).toHaveCSS(
        'object-position',
        '75% 25%',
      )
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(across).toHaveValue('0.5')
    await expect(down).toHaveValue('0.5')
    await expect(hero).toHaveCSS('object-position', '50% 50%')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(across).toHaveValue('0.75')
    await expect(down).toHaveValue('0.25')
    await expect(hero).toHaveCSS('object-position', '75% 25%')
    await capture('dragged')
    await dot.press('ArrowRight')
    await expect(across).toHaveValue('0.76')
    await dot.press('Shift+ArrowDown')
    await expect(down).toHaveValue('0.35')
    await expect(hero).toHaveCSS('object-position', '76% 35%')
    await capture('keyboard')
    for (const [label, ratio] of [
      ['Card', 4 / 3],
      ['Phone', 3 / 4],
      ['Wide', 16 / 9],
    ] as const) {
      const crop = await focus.getByRole('img', { name: label + ' crop preview', exact: true }).boundingBox()
      expect(crop!.width / crop!.height).toBeCloseTo(ratio, 2)
    }
    const edge = await dot.locator('img').boundingBox()
    await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height / 2)
    await page.mouse.down()
    await page.mouse.move(edge!.x - 40, edge!.y - 40)
    await page.mouse.up()
    await expect(across).toHaveValue('0')
    await expect(down).toHaveValue('0')
    await expect(hero).toHaveCSS('object-position', '0% 0%')
    await capture('bounded-edge')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(across).toHaveValue('0.76')
    await expect(down).toHaveValue('0.35')
    const cancel = await dot.locator('img').boundingBox()
    await page.mouse.move(cancel!.x + cancel!.width / 2, cancel!.y + cancel!.height / 2)
    await page.mouse.down()
    await page.mouse.move(cancel!.x + cancel!.width * 0.2, cancel!.y + cancel!.height * 0.2)
    await dot.dispatchEvent('pointercancel', { pointerId: 1 })
    await page.mouse.up()
    await expect(across).toHaveValue('0.76')
    await expect(down).toHaveValue('0.35')
    await expect(hero).toHaveCSS('object-position', '76% 35%')
    await saveDraft(page)
    expect((await rawRequest({ host: f.hostname, path: '/' })).body).toBe(original)
    const content = (
      await f.pool.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [home],
      )
    ).rows[0]!.content
    const stored = content[0].values.photo.focal
    expect(content[0].values.__cms_sample_fields ?? []).not.toContain('photo')
    expect(stored).toEqual({ x: 0.76, y: 0.35 })
    await page.reload()
    await expect(hero).toHaveCSS('object-position', '76% 35%')
    await hero.click()
    await focus.locator('summary').click()
    await expect(across).toHaveValue('0.76')
    await publish(page)
    expect((await rawRequest({ host: f.hostname, path: '/' })).body).toContain('style="object-position:76% 35%"')
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(hero).toHaveCSS('object-position', '76% 35%')
    await capture('phone-preview')
    const visitor = await browser.newContext({ javaScriptEnabled: false }),
      view = await visitor.newPage()
    try {
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
        await view.goto('http://' + f.hostname + `:${E2E_PORTS.site}/`)
        await expect(view.locator('#s0 img').first()).toHaveCSS('object-position', '76% 35%')
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'published-' + width + '.png'), fullPage: true })
      }
    } finally {
      await visitor.close()
    }
    await focus.getByRole('button', { name: 'Use automatic crop', exact: true }).click()
    await expect(across).toHaveValue('0.5')
    await expect(down).toHaveValue('0.5')
    await expect(hero).toHaveCSS('object-position', '50% 50%')
    await capture('reset')
    expect((await rawRequest({ host: f.hostname, path: '/' })).body).toContain('style="object-position:76% 35%"')
    // An unavailable image still leaves labelled keyboard controls and a reset.
    await saveDraft(page)
    provokedImageFailure = true
    await page.route('**/media/' + mediaId + '/**', route => route.abort('failed'))
    await page.reload()
    await hero.click()
    await expect(focus.getByRole('status')).toContainText('You can still set')
    await focus.locator('summary').click()
    await dot.press('Home')
    await expect(across).toHaveValue('0.5')
    await expect(down).toHaveValue('0.5')
    await capture('unavailable')
    await page.unroute('**/media/' + mediaId + '/**')
    await focus.getByRole('button', { name: 'Try image again', exact: true }).click()
    await expect(focus.getByRole('img', { name: /crop preview$/ })).toHaveCount(3)
    await dot.press('ArrowRight')
    await expect.poll(() => hero.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    provokedImageFailure = false
    for (const url of readonlyWarnings) {
      const response = await page.request.get(url)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
      expect(response.headers()['content-security-policy']).toContain('sandbox allow-same-origin')
      expect(await response.text()).not.toMatch(/<script\b/i)
    }
    expect(errors).toEqual([])
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
