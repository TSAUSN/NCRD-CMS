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
import { echelonEngagementContent } from '../../packages/seeds/src/echelon-engagement.ts'
import { signIn, canvas, publish } from './helpers.ts'
test('chapter event dates and no-script details work while Follow can use saved site accounts without replacing chapter links', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/echelon-engagement/' + info.project.name)
  let objects: string[] = []
  try {
    const target = e2eTarget()
    const foreign = (await f.pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
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
          values: { heading: '[Echelon engagement]', intro: '' },
        },
        ...echelonEngagementContent(definitions),
      ],
      slug = 'body-' + randomUUID().slice(0, 8),
      id = (await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, slug, '[Echelon engagement]']))
        .rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify(content),
      JSON.stringify({ description: '[Echelon engagement template check]' }),
    ])
    await f.client.query('SELECT app.save_site_settings_draft($1,0,$2)', [
      f.site,
      JSON.stringify({
        schemaVersion: 1,
        name: '[Echelon engagement]',
        social: [{ service: 'instagram', url: 'https://instagram.com/example-chapter/', handle: '', inFooter: false }],
      }),
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
        await expect(view.getByRole('heading', { name: 'What’s coming up', exact: true })).toBeVisible()
        await expect(view.locator('.ech-agenda-event')).toHaveCount(3)
        await expect(view.getByText('Sample events', { exact: true })).toBeVisible()
        await expect(view.locator('.ech-agenda-date time').nth(1)).toHaveAttribute('datetime', '2026-11-07')
        await expect(view.getByRole('navigation', { name: 'Chapter social media', exact: true })).toHaveCount(0)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
        await view.getByText('Event details', { exact: false }).first().click()
        await expect(view.locator('.ech-agenda-details[open]')).toHaveCount(1)
        await expect(
          view
            .getByText('Contact the chapter for the time, meeting place and registration information.', { exact: true })
            .first(),
        ).toBeVisible()
        await view.screenshot({ path: resolve(folder, 'open-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
    await page.goto('/pages/' + id + '?section=1')
    const inspector = page.locator('.inspector')
    await inspector.getByRole('button', { name: 'Community service morning', exact: true }).click()
    const date = inspector.getByLabel('Event date', { exact: true })
    await expect(date).toHaveAttribute('type', 'date')
    await date.fill('2026-12-09')
    await expect(canvas(page).locator('.ech-agenda-date time').first()).toHaveAttribute('datetime', '2026-12-09')
    expect(
      await canvas(page)
        .locator('.ech-agenda-date time')
        .first()
        .evaluate(
          node =>
            node.querySelector('strong')!.getBoundingClientRect().top >=
            node.querySelector('span')!.getBoundingClientRect().bottom,
        ),
    ).toBe(true)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png') })
    }
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
    ).toBe(live)
    await publish(page)
    await page.goto(publicUrl)
    await expect(page.locator('.ech-agenda-date time').first()).toHaveAttribute('datetime', '2026-12-09')
    await page.goto('/pages/' + id + '?section=2')
    await page.getByLabel('Links from', { exact: true }).selectOption('site')
    await expect(page.getByText('These accounts come from site Settings.', { exact: false })).toBeVisible()
    await expect(
      canvas(page)
        .getByRole('navigation', { name: 'Chapter social media', exact: true })
        .getByRole('link', { name: 'Instagram', exact: true }),
    ).toHaveAttribute('href', 'https://instagram.com/example-chapter/')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    await publish(page)
    await page.goto(publicUrl)
    await expect(
      page.getByRole('navigation', { name: 'Chapter social media', exact: true }).getByRole('link'),
    ).toHaveCount(1)
    await expect(page.getByText('Sample social links', { exact: true })).toHaveCount(0)
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'site-accounts-' + width + '.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 950 })
    await page.goto('/pages/' + id + '?section=2')
    await page.getByLabel('Links from', { exact: true }).selectOption('own')
    await expect(canvas(page).getByRole('navigation', { name: 'Chapter social media', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
