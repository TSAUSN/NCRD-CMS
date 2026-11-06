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
import { ChapterSetup } from '@cms/schema'
import { echelonChapterTemplate } from '../../packages/seeds/src/echelon-chapter-template.ts'
import { signIn, canvas } from './helpers.ts'
test('reviewed chapter composition uses shared sections and supplied Media fields, keeps native links and disclosures, and edits without moving its layout', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await echelonFixture(false, false, true),
    folder = resolve('../.r8-progress/round3/echelon-composition/' + info.project.name)
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
    const photo = {
        media_id: imported.mediaId,
        variant: 'wide',
        src: '/media/' + imported.mediaId + '/wide',
        alt: '[Chapter photo placeholder]',
        decorative: false,
        focal: { x: 0.6, y: 0.46 },
      },
      assets = { media: { logo: photo, photo, portrait: photo, photo_two: photo, photo_three: photo } }
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const definitions = (
        await f.client.query(
          "SELECT d.id,d.slug,d.name,v.version,v.slots FROM section_defs d JOIN LATERAL(SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug LIKE 'core-echelon-%'",
        )
      ).rows,
      content = echelonChapterTemplate(
        definitions,
        assets.media,
        ChapterSetup.parse({
          name: '[Reviewed chapter template]',
          destination: 'page',
          pageId: null,
          externalUrl: null,
          contact: { name: '[Name]', role: '[Role]', email: 'chapter@example.test' },
          sections: {},
        }),
      ),
      slug = 'chapter-template',
      id = (await f.client.query('SELECT app.create_page($1,$2,$3) id', [f.site, slug, '[Reviewed chapter template]']))
        .rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify(content),
      JSON.stringify({ description: '[Reviewed Echelon chapter composition]' }),
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
        const main = view.locator('main.cms-echelon-page')
        await expect(main).toBeVisible()
        expect(await main.evaluate(node => getComputedStyle(node).fontWeight)).toBe('400')
        await expect(main.locator('.echelon-opener img')).toHaveCount(2)
        await expect(main.getByRole('heading', { name: '[Reviewed chapter template]', exact: true })).toBeVisible()
        await expect(main.locator('.ech-board-person')).toHaveCount(4)
        await expect(main.locator('.ech-faq-item')).toHaveCount(4)
        expect(
          await main
            .locator('img')
            .evaluateAll(nodes =>
              nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
            ),
        ).toBe(true)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect(
          await main
            .locator('h2')
            .evaluateAll(nodes => nodes.every(node => getComputedStyle(node).fontVariant === 'normal')),
        ).toBe(true)
        await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
        for (const section of [
          'core-echelon-hero',
          'core-echelon-about',
          'core-echelon-who',
          'core-echelon-pillars',
          'core-echelon-events',
          'core-echelon-chapter-contacts',
          'core-echelon-board',
          'core-echelon-faq',
          'core-echelon-contact',
        ])
          await main
            .locator('.cms-section--' + section)
            .screenshot({ path: resolve(folder, section + '-' + width + '.png') })
        await main.getByRole('link', { name: 'Explore events', exact: true }).click()
        await expect(view).toHaveURL(/#ech-demo-events$/)
        await expect
          .poll(() =>
            main.getByRole('heading', { name: 'What’s coming up', exact: true }).evaluate(node => {
              const top = node.getBoundingClientRect().top
              return top >= 0 && top < innerHeight / 2
            }),
          )
          .toBe(true)
        await main.getByText('What is Echelon?', { exact: true }).click()
        await expect(main.locator('.ech-faq-item').nth(0)).toHaveAttribute('open', '')
        await main.getByText('What does Echelon do?', { exact: true }).click()
        await expect(main.locator('.ech-faq-item').nth(0)).not.toHaveAttribute('open', '')
        await expect(main.locator('.ech-faq-item').nth(1)).toHaveAttribute('open', '')
        await main
          .locator('.cms-section--core-echelon-faq')
          .screenshot({ path: resolve(folder, 'faq-open-' + width + '.png') })
        await main.locator('.ech-agenda-details').first().locator('summary').click()
        await expect(main.locator('.ech-agenda-details').first()).toHaveAttribute('open', '')
        await main
          .locator('.cms-section--core-echelon-events')
          .screenshot({ path: resolve(folder, 'events-open-' + width + '.png') })
      }
      for (const width of [1240, 358]) {
        await view.setViewportSize({ width, height: 950 })
        await view.goto(url)
        await view.screenshot({ path: resolve(folder, 'reference-width-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
    await page.goto('/pages/' + id + '?section=0')
    const before = await canvas(page)
      .locator('.echelon-opener')
      .evaluate(node => getComputedStyle(node).gridTemplateColumns)
    await page.goto('/pages/' + id + '?section=3')
    expect(
      await canvas(page)
        .locator('.echelon-opener')
        .evaluate(node => getComputedStyle(node).gridTemplateColumns),
    ).toBe(before)
    await page.locator('.inspector').getByLabel('First paragraph', { exact: true }).fill('[Chapter-owned introduction]')
    await expect(canvas(page).getByText('[Chapter-owned introduction]', { exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
    ).toBe(live)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
