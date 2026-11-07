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
import { echelonBoardContactsContent } from '../../../packages/seeds/src/echelon-board-contacts.ts'
import { signIn, canvas, publish } from '../helpers.ts'
test('chapter contacts keep named fields and long boards keep all photos with eight-first no-script disclosure and stable selection layout', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false, true),
    folder = resolve('../.r8-progress/round3/echelon-board-contacts/' + info.project.name)
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
    const defs = (
        await f.client.query(
          "SELECT d.id,d.slug,d.name,v.version,v.slots FROM section_defs d JOIN LATERAL(SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug IN ('core-echelon-chapter-contacts','core-echelon-board','core-page-header')",
        )
      ).rows,
      header = defs.find(row => row.slug === 'core-page-header')!,
      parts = echelonBoardContactsContent(defs),
      board = parts[1]!,
      slug = 'board-' + randomUUID().slice(0, 8),
      id = (await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, slug, '[Echelon board]'])).rows[0]!
        .id
    board.values.cards = { items: Array.from({ length: 16 }, (_, n) => 'i' + (n + 1)) }
    for (let n = 1; n <= 16; n++) {
      board.values['cards__i' + n + '__name'] = '[Name ' + n + ']'
      board.values['cards__i' + n + '__role'] = '[Role]'
      board.values['cards__i' + n + '__photo'] = {
        media_id: imported.mediaId,
        variant: 'card',
        src: '/media/' + imported.mediaId + '/card',
        alt: '[Board photo ' + n + ']',
        decorative: false,
      }
    }
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify([
        {
          section_def_id: header.id,
          section_def_version: header.version,
          values: { heading: '[Echelon board]', intro: '' },
        },
        ...parts,
      ]),
      JSON.stringify({ description: '[Echelon contact and board check]' }),
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
      url = 'http://' + f.hostname + `:${E2E_PORTS.site}/` + slug,
      context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const view = await context.newPage()
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 950 })
        await view.goto(url)
        await expect(view.getByText('[Membership chair name]', { exact: true })).toBeVisible()
        await expect(view.locator('.ech-board-person')).toHaveCount(16)
        await expect(view.locator('.ech-board-person:visible')).toHaveCount(8)
        await expect(view.locator('.ech-board-person img:visible')).toHaveCount(8)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'closed-' + width + '.png'), fullPage: true })
        await view.getByText('Show all 16 board members', { exact: true }).click()
        await expect(view.locator('.ech-board-person:visible')).toHaveCount(16)
        await expect(view.locator('.ech-board-person img:visible')).toHaveCount(16)
        await view.screenshot({ path: resolve(folder, 'open-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
    await page.goto('/pages/' + id + '?section=0')
    const before = await canvas(page)
      .locator('.ech-board-grid')
      .evaluate(node => getComputedStyle(node).gridTemplateColumns)
    await page.goto('/pages/' + id + '?section=2')
    expect(
      await canvas(page)
        .locator('.ech-board-grid')
        .evaluate(node => getComputedStyle(node).gridTemplateColumns),
    ).toBe(before)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'editor-board-' + width + '.png') })
    }
    await page.goto('/pages/' + id + '?section=1')
    await page.locator('.inspector').getByLabel('Membership chair name', { exact: true }).fill('[Name]')
    await expect(canvas(page).getByText('[Name]', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
    ).toBe(live)
    await publish(page)
    await page.goto(url)
    await expect(page.getByText('[Name]', { exact: true })).toBeVisible()
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.archive()
    f.client.release()
    await f.pool.end()
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
