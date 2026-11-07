import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { e2eTarget } from '../../test-target.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
const run = promisify(execFile)
import { echelonFixture } from '../fixtures/echelon.ts'
import { echelonLeadershipContent } from '../../../packages/seeds/src/echelon-leadership.ts'
import { signIn, canvas, publish } from '../helpers.ts'
test('national leadership keeps its group photo and editable council portraits through drafts and reviewed publishing', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false, true),
    folder = resolve('../.r8-progress/round3/echelon-leadership/' + info.project.name)
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
        alt: '[Echelon photo placeholder]',
        decorative: false,
      },
      header = definitions.find(row => row.slug === 'core-page-header')!,
      content = [
        {
          section_def_id: header.id,
          section_def_version: header.version,
          values: { heading: '[Echelon leadership]', intro: '' },
        },
        echelonLeadershipContent(definitions, {
          photo,
          portrait_one: photo,
          portrait_two: photo,
          portrait_three: photo,
          portrait_four: photo,
        }),
      ],
      slug = 'body-' + randomUUID().slice(0, 8),
      id = (await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, slug, '[Echelon leadership]']))
        .rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify(content),
      JSON.stringify({ description: '[Echelon leadership template check]' }),
    ])
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
        await expect(view.getByRole('heading', { name: 'Our leadership', exact: true })).toBeVisible()
        await expect(view.locator('.ech-lead-feature img')).toHaveCount(1)
        await expect(view.locator('.ech-roster .ech-person')).toHaveCount(4)
        await expect(view.locator('.ech-roster img')).toHaveCount(4)
        await expect(view.getByRole('link', { name: 'Meet the full council →', exact: true })).toHaveAttribute(
          'target',
          '_blank',
        )
        expect(
          await view
            .locator('.ech-roster')
            .evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length),
        ).toBe(width === 390 ? 2 : 4)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
    await page.goto('/pages/' + id + '?section=1')
    const inspector = page.locator('.inspector')
    await inspector.getByLabel('Introduction', { exact: true }).fill('[Updated leadership introduction]')
    await expect(canvas(page).getByText('[Updated leadership introduction]', { exact: true })).toBeVisible()
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
    await expect(page.getByText('[Updated leadership introduction]', { exact: true })).toBeVisible()
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
