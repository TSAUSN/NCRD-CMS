import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { e2eTarget } from '../test-target.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
const run = promisify(execFile)
import { echelonFixture } from './fixtures/echelon.ts'
import { echelonBodyContent } from '../../packages/seeds/src/echelon-body-library.ts'
import { signIn, canvas, publish } from './helpers.ts'
test('shared Echelon purpose, three-photo collage and pillars stay editable fields with safe private saves and no-script public layouts', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/echelon-body/' + info.project.name)
  let objects: string[] = []
  try {
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
    objects = imported.objects
    await mkdir(folder, { recursive: true })
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const definitions = (
        await f.client.query(
          "SELECT d.id,d.slug,d.name,v.version,v.slots FROM section_defs d JOIN LATERAL(SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug LIKE 'core-echelon-%' OR d.slug='core-page-header'",
        )
      ).rows,
      photo = {
        media_id: imported.mediaId,
        variant: 'wide',
        src: '/media/' + imported.mediaId + '/wide',
        alt: '[Reference photo description]',
        decorative: false,
      },
      header = definitions.find(row => row.slug === 'core-page-header')!,
      content = [
        {
          section_def_id: header.id,
          section_def_version: header.version,
          values: { heading: '[Echelon body]', intro: '' },
        },
        ...echelonBodyContent('chapter', definitions, { portrait: photo, photo_two: photo, photo_three: photo }),
      ],
      slug = 'body-' + randomUUID().slice(0, 8),
      id = (await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, slug, '[Echelon body]'])).rows[0]!
        .id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify(content),
      JSON.stringify({ description: '[Echelon body template check]' }),
    ])
    const starters = (
      await f.client.query(
        'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1',
        [f.site],
      )
    ).rows
    for (const starter of starters) {
      let changed = false
      const sections = starter.content.map((section: { values: Record<string, unknown> }) => ({
        ...section,
        values: Object.fromEntries(
          Object.entries(section.values).map(([key, value]) => {
            if (
              value &&
              typeof value === 'object' &&
              'src' in value &&
              typeof value.src === 'string' &&
              value.src.startsWith('/cms-samples/')
            ) {
              changed = true
              return [key, photo]
            }
            return [key, value]
          }),
        ),
      }))
      if (changed)
        await f.client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          starter.id,
          starter.revision,
          JSON.stringify(sections),
          JSON.stringify(starter.meta),
        ])
    }
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/publishing')
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const live = (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!
        .published_version_id,
      publicUrl = 'http://' + f.hostname + `:${E2E_PORTS.site}/` + slug,
      context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const view = await context.newPage()
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 950 })
        await view.goto(publicUrl)
        await expect(
          view.getByRole('heading', { name: 'A community of purpose in action.', exact: true }),
        ).toBeVisible()
        await expect(view.locator('.ech-about-collage img')).toHaveCount(3)
        await expect(view.locator('.ech-purpose-grid .ech-benefit')).toHaveCount(3)
        await expect(view.locator('.echelon-template').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        await expect(view.locator('.ech-purpose .ech-benefit').first()).toHaveCSS(
          'background-color',
          'rgb(255, 255, 255)',
        )
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await expect(view.locator('.cms-material-symbols').filter({ hasText: 'adjust' })).toBeVisible()
        await expect(view.locator('.cms-material-symbols').filter({ hasText: 'redeem' })).toBeVisible()
        const statements = await view.locator('.ech-about-intro-item').all(),
          first = await statements[0]!.boundingBox(),
          second = await statements[1]!.boundingBox(),
          divider = await view.locator('.ech-about-intro-divider').boundingBox()
        if (width === 390) {
          expect(divider!.y).toBeGreaterThanOrEqual(first!.y + first!.height)
          expect(second!.y).toBeGreaterThanOrEqual(divider!.y + divider!.height)
        } else {
          expect(divider!.x).toBeGreaterThan(first!.x)
          expect(second!.x).toBeGreaterThan(divider!.x)
        }
        await view.locator('.ech-about-collage img').evaluateAll(async images => {
          await Promise.all(
            images.map(image => {
              if (!(image instanceof HTMLImageElement)) throw new Error('Expected a collage image')
              image.loading = 'eager'
              return image.decode()
            }),
          )
        })
        for (const image of await view.locator('.ech-about-collage img').all()) {
          const box = await image.boundingBox()
          expect(box!.width).toBeGreaterThan(100)
          expect(box!.height).toBeGreaterThan(100)
        }
        await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
    await page.goto('/pages/' + id + '?section=2')
    const inspector = page.locator('.inspector')
    await inspector.getByLabel('First paragraph', { exact: true }).fill('[Updated chapter paragraph]')
    await expect(canvas(page).getByText('[Updated chapter paragraph]', { exact: true })).toBeVisible()
    await expect(inspector.getByText('Card', { exact: true })).toHaveCount(3)
    await expect(inspector.getByText('Phone', { exact: true })).toHaveCount(3)
    await expect(inspector.getByText('Wide', { exact: true })).toHaveCount(3)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
    ).toBe(live)
    await publish(page)
    await page.goto(publicUrl)
    await expect(page.getByText('[Updated chapter paragraph]', { exact: true })).toBeVisible()
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
