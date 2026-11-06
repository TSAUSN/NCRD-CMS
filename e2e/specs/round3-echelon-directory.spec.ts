import { E2E_PORTS } from '../test-ports.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { e2eTarget } from '../test-target.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { ChapterSetup } from '@cms/schema'
import { echelonFixture } from './fixtures/echelon.ts'
import { saveChapterInTransaction } from '../../apps/admin/src/lib/chapters.ts'
import { signIn, canvas } from './helpers.ts'
async function release(page: Page, site: string) {
  await page.goto('/sites/' + site + '/publishing')
  const privatePick = page.getByRole('checkbox', { name: /Private chapter/ })
  if (await privatePick.count()) await privatePick.uncheck()
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  const samples = page.getByRole('checkbox', { name: /Publish with sample content/ }),
    confirm = page.getByRole('alertdialog', { name: 'Publish selected changes?', exact: true })
  await expect.poll(async () => (await samples.isVisible()) || (await confirm.isVisible())).toBe(true)
  if (await samples.isVisible()) {
    await samples.check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  }
  await confirm.getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('national map uses published chapter identities, native search and links, safe popup details and current destinations after renaming', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await echelonFixture(false, false),
    other = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/echelon-directory/' + info.project.name)
  let mapPage = '',
    mapSlug = '',
    peoria = ''
  const objects: string[] = []
  const config = (
    name: string,
    destination: 'page' | 'external' | 'division' | 'unlisted',
    pageId: string | null,
    externalUrl: string | null,
  ) =>
    ChapterSetup.parse({
      name,
      destination,
      pageId,
      externalUrl,
      contact: { name: '[Name]', role: '[Role]', email: 'private-contact@example.test' },
      sections: {},
    })
  try {
    // Generic Echelon starters deliberately retain private sample images. Supply
    // governed Media for this publication fixture without weakening that guard.
    const target = e2eTarget()
    const foreign = (await f.pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    for (const fixture of [f, other]) {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          '--conditions=react-server',
          '--experimental-strip-types',
          '--no-warnings',
          'e2e/fixtures/echelon-media-runner.ts',
          fixture.actor,
          fixture.site,
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
        },
      )
      const imported = JSON.parse(stdout.trim().split('\n').at(-1)!)
      objects.push(...imported.objects)
      const photo = {
        media_id: imported.mediaId,
        variant: 'wide',
        src: '/media/' + imported.mediaId + '/wide',
        alt: '[Reference photo description]',
        decorative: false,
      }
      await fixture.client.query('BEGIN')
      await fixture.client.query('SET LOCAL ROLE cms_authenticated_user')
      await fixture.client.query("SELECT set_config('app.user_id',$1,true)", [fixture.actor])
      const starters = (
        await fixture.client.query(
          'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1',
          [fixture.site],
        )
      ).rows
      for (const starter of starters) {
        let changed = false
        const content = starter.content.map((section: { values: Record<string, unknown> }) => ({
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
          await fixture.client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
            starter.id,
            starter.revision,
            JSON.stringify(content),
            JSON.stringify(starter.meta),
          ])
      }
      await fixture.client.query('COMMIT')
    }
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await release(page, f.site)
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const definitions = (
        await f.client.query(
          "SELECT d.id,d.slug,d.name,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug IN ('core-page-header','core-echelon-directory')",
        )
      ).rows,
      header = definitions.find(row => row.slug === 'core-page-header')!,
      directory = definitions.find(row => row.slug === 'core-echelon-directory')!,
      local = (await f.client.query("SELECT app.create_page($1,'chapters/peoria','Peoria Chapter') id", [f.site]))
        .rows[0]!.id
    peoria = (
      await f.client.query("SELECT chapter_id FROM app.save_chapter_setup($1,NULL,0,'peoria',$2)", [
        f.site,
        JSON.stringify(config('Peoria Chapter', 'page', local, null)),
      ])
    ).rows[0]!.chapter_id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      local,
      JSON.stringify([
        {
          section_def_id: header.id,
          section_def_version: header.version,
          values: { heading: 'Peoria Chapter', intro: '' },
        },
      ]),
      JSON.stringify({ description: '[Chapter check]' }),
    ])
    mapSlug = 'directory-' + randomUUID().slice(0, 8)
    mapPage = (await f.client.query('SELECT app.create_page($1,$2,$3) id', [f.site, mapSlug, '[Echelon directory]']))
      .rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      mapPage,
      JSON.stringify([
        {
          section_def_id: header.id,
          section_def_version: header.version,
          values: { heading: '[Echelon directory]', intro: '' },
        },
        {
          section_def_id: directory.id,
          section_def_version: directory.version,
          values: {
            heading: 'Find your Echelon chapter',
            intro: 'Choose a chapter to explore local opportunities and get connected.',
            __cms_anchor: 'ech-demo-chapters',
          },
        },
      ]),
      JSON.stringify({ description: '[Directory check]' }),
    ])
    for (const [slug, name, destination, url] of [
      ['detroit', 'Detroit Chapter', 'external', 'https://chapter.example.test/detroit'],
      ['division-linked', '[Unmapped chapter]', 'division', 'https://division.example.test/echelon'],
      ['private-chapter', '[Private chapter]', 'external', 'https://private.example.test/'],
      ['unlisted', '[Unlisted chapter]', 'unlisted', null],
    ] as const)
      await f.client.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [
        f.site,
        slug,
        JSON.stringify(config(name, destination, null, url)),
      ])
    await f.client.query("SELECT * FROM app.save_chapter_setup($1,NULL,0,'other-site',$2)", [
      other.site,
      JSON.stringify(config('[Other site chapter]', 'external', null, 'https://other.example.test/')),
    ])
    await f.client.query('COMMIT')
    await release(page, other.site)
    await release(page, f.site)
    const url = 'http://' + f.hostname + `:${E2E_PORTS.site}/` + mapSlug,
      live = (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [mapPage])).rows[0]!
        .published_version_id,
      view = await browser.newPage(),
      errors: string[] = []
    view.on('pageerror', error => errors.push(error.message))
    try {
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 950 })
        await view.goto(url)
        const root = view.locator('[data-cms-echelon-directory]')
        await expect(root).toHaveAttribute('data-chapter-ready', '')
        await expect(root.locator('[data-chapter-entry]')).toHaveCount(3)
        await expect(root.locator('[data-chapter-marker]')).toHaveCount(2)
        await expect(view.getByText('[Private chapter]', { exact: true })).toHaveCount(0)
        await expect(view.getByText('[Unlisted chapter]', { exact: true })).toHaveCount(0)
        await expect(view.getByText('[Other site chapter]', { exact: true })).toHaveCount(0)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
        const marker = root.getByRole('link', { name: 'Peoria Chapter', exact: true })
        await marker.click()
        const popup = root.getByRole('region', { name: 'Selected chapter', exact: true })
        await expect(popup.getByRole('link', { name: 'Visit webpage →', exact: true })).toHaveAttribute(
          'href',
          '/chapters/peoria',
        )
        await view.screenshot({ path: resolve(folder, 'popup-' + width + '.png'), fullPage: true })
        await view.keyboard.press('Escape')
        await expect(popup).toBeHidden()
        await expect(marker).toBeFocused()
        await root.getByRole('searchbox', { name: 'Find a chapter by name', exact: true }).fill('Detroit')
        await expect(root.locator('[data-chapter-entry]:visible')).toHaveCount(1)
        await expect(root.locator('[data-chapter-marker]:visible')).toHaveCount(1)
        await root.getByRole('searchbox', { name: 'Find a chapter by name', exact: true }).fill('Nothing matches')
        await expect(root.getByRole('status')).toContainText('No chapters match your search. Try another name.')
        await view.screenshot({ path: resolve(folder, 'empty-' + width + '.png'), fullPage: true })
      }
      expect(errors).toEqual([])
    } finally {
      await view.close()
    }
    const noScript = await browser.newContext({ javaScriptEnabled: false })
    try {
      const native = await noScript.newPage()
      for (const width of [1440, 1024, 390]) {
        await native.setViewportSize({ width, height: 950 })
        await native.goto(url)
        const root = native.locator('[data-cms-echelon-directory]')
        await expect(root.getByRole('link', { name: 'Detroit Chapter', exact: true })).toHaveAttribute(
          'href',
          'https://chapter.example.test/detroit',
        )
        await root.getByRole('searchbox', { name: 'Find a chapter by name', exact: true }).fill('Detroit')
        await root.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(native).toHaveURL(/q=Detroit/)
        await expect(root.locator('[data-chapter-entry]:visible')).toHaveCount(1)
        await native.screenshot({ path: resolve(folder, 'nojs-' + width + '.png'), fullPage: true })
      }
    } finally {
      await noScript.close()
    }
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const current = (
      await f.client.query(
        'SELECT c.revision,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1',
        [peoria],
      )
    ).rows[0]!
    await saveChapterInTransaction(f.client, f.site, peoria, current.revision, 'peoria', {
      ...current.config,
      name: '[Renamed Peoria chapter]',
    })
    await f.client.query('COMMIT')
    await release(page, f.site)
    await page.goto(url)
    await expect(page.getByRole('link', { name: '[Renamed Peoria chapter]', exact: true })).toHaveAttribute(
      'data-chapter-marker',
      'peoria',
    )
    await expect(page.getByRole('link', { name: '[Renamed Peoria chapter]', exact: true })).toHaveAttribute(
      'href',
      '/chapters/peoria',
    )
    const entries = (await f.pool.query('SELECT public_api.chapter_directory($1) entries', [f.hostname])).rows[0]!
      .entries
    expect(JSON.stringify(entries)).not.toContain('private-contact@example.test')
    expect(entries.map((entry: { slug: string }) => entry.slug).sort()).toEqual([
      'detroit',
      'division-linked',
      'peoria',
    ])
    await page.goto('/pages/' + mapPage + '?section=0')
    const columns = await canvas(page)
      .locator('.ech-map-layout')
      .evaluate(node => getComputedStyle(node).gridTemplateColumns)
    await page.goto('/pages/' + mapPage + '?section=1')
    expect(
      await canvas(page)
        .locator('.ech-map-layout')
        .evaluate(node => getComputedStyle(node).gridTemplateColumns),
    ).toBe(columns)
    await page
      .locator('.inspector')
      .getByLabel('Introduction', { exact: true })
      .fill('[Updated directory introduction]')
    await expect(canvas(page).getByText('[Updated directory introduction]', { exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, 'editor-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [mapPage])).rows[0]!
        .published_version_id,
    ).toBe(live)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    for (const fixture of [f, other]) {
      await fixture.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [fixture.site])
      fixture.client.release()
      await fixture.pool.end()
    }
    const store = createFilesystemMediaStore(defaultMediaRoot())
    for (const key of objects) await store.remove(key)
  }
})
