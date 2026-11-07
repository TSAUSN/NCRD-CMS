import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { e2eTarget } from '../../test-target.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
const run = promisify(execFile)
import { echelonFixture } from '../fixtures/echelon.ts'
import { CORE_LIBRARY, corePreviewValues } from '@cms/seeds/core-library'
import { signIn, canvas, publish } from '../helpers.ts'
test('Echelon shared opener uses fixed navy columns, a visible logo, normal editable fields and no-JavaScript jump links', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/echelon-openers/' + info.project.name)
  let id = ''
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
        "SELECT d.id,d.slug,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug IN ('core-echelon-hero','core-echelon-jump-links','core-text-block')",
      )
    ).rows
    const section = (slug: string, values: Record<string, unknown>) => {
        const def = definitions.find(row => row.slug === slug)!
        return { section_def_id: def.id, section_def_version: def.version, values }
      },
      hero = corePreviewValues(CORE_LIBRARY.find(entry => entry.definition.slug === 'core-echelon-hero')!),
      jump = corePreviewValues(CORE_LIBRARY.find(entry => entry.definition.slug === 'core-echelon-jump-links')!)
    hero.logo = {
      media_id: imported.mediaId,
      variant: 'card',
      src: '/media/' + imported.mediaId + '/card',
      alt: '[Echelon logo placeholder]',
      decorative: false,
    }
    hero.photo = {
      media_id: imported.mediaId,
      variant: 'wide',
      src: '/media/' + imported.mediaId + '/wide',
      alt: '[Echelon photo placeholder]',
      decorative: false,
    }
    hero.heading = '[Chapter opener]'
    hero.primary = { label: 'Explore events', url: '#ech-demo-events' }
    hero.secondary = { label: 'Join us', url: '#ech-demo-contact' }
    jump.links = { items: ['i1', 'i2'] }
    jump.links__i1__icon = 'calendar'
    jump.links__i1__action = { label: 'Events', url: '#ech-demo-events' }
    jump.links__i2__icon = 'mail'
    jump.links__i2__action = { label: 'Join us', url: '#ech-demo-contact' }
    id = (
      await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [
        f.site,
        'opener-' + randomUUID().slice(0, 8),
        '[Echelon opener]',
      ])
    ).rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify([
        section('core-echelon-hero', hero),
        section('core-echelon-jump-links', jump),
        section('core-text-block', {
          heading: '[Events]',
          body: '<p>[Chapter events]</p>',
          __cms_anchor: 'ech-demo-events',
        }),
        section('core-text-block', {
          heading: '[Contact]',
          body: '<p>[Chapter contact]</p>',
          __cms_anchor: 'ech-demo-contact',
        }),
      ]),
      JSON.stringify({ description: '[Echelon opener reference check]' }),
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
              return [key, hero.photo]
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
    const slug = (await f.pool.query('SELECT slug FROM pages WHERE id=$1', [id])).rows[0]!.slug,
      publicUrl = 'http://' + f.hostname + `:${E2E_PORTS.site}/` + slug,
      live = (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!
        .published_version_id
    const context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const view = await context.newPage()
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 950 })
        await view.goto(publicUrl)
        await expect(view.locator('.echelon-opener-logo img')).toBeVisible()
        await expect(view.locator('.echelon-opener')).toHaveCSS('background-color', 'rgb(0, 32, 86)')
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const copy = await view.locator('.echelon-opener-copy').boundingBox(),
          photo = await view.locator('.echelon-opener-photo').boundingBox()
        expect(copy).toBeTruthy()
        expect(photo).toBeTruthy()
        if (width > 767) expect(photo!.x).toBeGreaterThan(copy!.x)
        else expect(photo!.y).toBeGreaterThan(copy!.y)
        await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
        await view
          .getByRole('navigation', { name: 'On this page', exact: true })
          .getByRole('link', { name: 'Events', exact: true })
          .click()
        await expect(view).toHaveURL(/#ech-demo-events$/)
        await expect(view.locator('#ech-demo-events')).toBeInViewport()
      }
    } finally {
      await context.close()
    }
    await page.goto('/pages/' + id + '?section=0')
    const inspector = page.locator('.inspector')
    await expect(inspector.getByLabel('Page title', { exact: true })).toBeVisible()
    await inspector.getByLabel('Page title', { exact: true }).fill('[Updated Echelon page]')
    await expect(canvas(page).getByRole('heading', { name: '[Updated Echelon page]', exact: true })).toBeVisible()
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
    await expect(page.getByRole('heading', { name: '[Updated Echelon page]', exact: true })).toBeVisible()
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
