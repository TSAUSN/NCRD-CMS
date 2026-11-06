import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { processMediaBytes } from '../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/round3/header-screen', engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect
      .poll(() =>
        page.locator('#main').evaluate(main =>
          [...main.querySelectorAll('button,input,select,textarea,a[href],iframe')]
            .filter(element => element.getClientRects().length && !element.closest('dialog:not([open])'))
            .filter(element => {
              const box = element.getBoundingClientRect()
              return box.left < 0 || box.right > innerWidth + 1
            })
            .map(
              element =>
                element.getAttribute('aria-label') ||
                element.getAttribute('title') ||
                element.textContent?.slice(0, 60),
            ),
        ),
      )
      .toEqual([])
    await expect(page.getByText('Updating header preview…', { exact: true })).toHaveCount(0)
    if (width === 390 && (await page.getByRole('region', { name: 'Main menu', exact: true }).count())) {
      const labels = page.getByRole('region', { name: 'Main menu', exact: true }).locator('li > button > span')
      expect(await labels.count()).toBeGreaterThan(0)
      for (const label of await labels.all()) {
        expect(
          await label.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight),
        ).toBe(true)
      }
    }
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('Header & menu adds without leftovers, nests, edits identity and saves through draft commands', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    store = createFilesystemMediaStore(defaultMediaRoot()),
    objects: string[] = []
  try {
    const mediaId = randomUUID(),
      bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'header-fixture/input.png',
          finalKeyPrefix: 'header-fixture/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      original = processed.original
    for (const file of [original, ...processed.variants]) {
      await store.put(file.objectKey, file.data, file.mimeType)
      objects.push(file.objectKey)
    }
    await f.client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'[Logo fixture].png','[Sample landscape]',$5,$6,$7,$8,'ready')",
      [
        mediaId,
        f.siteId,
        original.objectKey,
        original.sha256,
        original.width,
        original.height,
        original.bytes,
        original.mimeType,
      ],
    )
    for (const file of processed.variants)
      await f.client.query(
        'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [mediaId, file.kind, file.objectKey, file.sha256, file.width, file.height, file.bytes, file.mimeType],
      )
    const admin = (await f.pool.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [admin, f.siteId, 'site_admin'])
    await f.client.query('COMMIT')
    await signIn(page, 'contributor@example.test')
    await page.goto('/sites/' + f.siteId + '/header')
    await expect(page.getByRole('heading', { level: 1, name: 'Header & menu', exact: true })).toBeVisible()
    const totals = (
      await f.pool.query(
        "SELECT (SELECT count(*)::int FROM pages p WHERE p.site_id=$1 AND p.archived_at IS NULL AND p.slug NOT LIKE 'stories/%' AND NOT EXISTS(SELECT 1 FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.site_id=$1 AND c.reader_key='stories' AND e.archived_at IS NULL AND v.values->>'story_url'=CASE WHEN p.slug='' THEN '/' ELSE '/'||p.slug END)) AS pages, (SELECT count(*)::int FROM collections c JOIN collection_entries e ON e.collection_id=c.id WHERE c.site_id=$1 AND c.reader_key='stories' AND e.archived_at IS NULL) AS stories",
        [f.siteId],
      )
    ).rows[0]
    const expectedCounts =
      `${totals.pages} ${totals.pages === 1 ? 'page' : 'pages'}` +
      (totals.stories ? ` · ${totals.stories} ${totals.stories === 1 ? 'story' : 'stories'}` : '')
    await expect(
      page.getByText(
        `Shown across ${expectedCounts} on ${(await f.pool.query('SELECT name FROM sites WHERE id=$1', [f.siteId])).rows[0].name}.`,
        { exact: false },
      ),
    ).toHaveCount(1)

    await expect(
      page.frameLocator('iframe[title="Header preview"]').locator('header .national-brand img'),
    ).toBeVisible()
    await capture(page, 'menu', info.project.name)
    const menu = page.getByRole('region', { name: 'Main menu', exact: true }),
      count = await menu.getByRole('listitem').count()
    await menu.getByRole('button', { name: 'Add to menu', exact: true }).click()
    const pageAdd = page.getByRole('dialog', { name: 'Add to menu', exact: true }),
      chooser = pageAdd.getByRole('combobox', { name: /^Page/ })
    await expect(pageAdd.getByLabel('Find a page', { exact: true })).toHaveCount(0)
    const firstChoice = (await pageAdd.locator('datalist option').first().getAttribute('value'))!
    await chooser.fill(firstChoice)
    await expect(pageAdd.getByLabel(/^Menu label/)).toHaveValue(
      firstChoice.slice(0, firstChoice.lastIndexOf(' — ')).slice(0, 80),
    )
    await pageAdd.getByLabel(/^Menu label/).fill('[Our own label]')
    await chooser.fill('')
    await expect(pageAdd.getByRole('button', { name: 'Done', exact: true })).toBeDisabled()
    const otherChoice = (await pageAdd.locator('datalist option').last().getAttribute('value'))!
    await chooser.fill(otherChoice)
    await expect(pageAdd.getByLabel(/^Menu label/)).toHaveValue('[Our own label]')
    await pageAdd.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(menu.getByRole('listitem')).toHaveCount(count)
    await menu.getByRole('button', { name: 'Add to menu', exact: true }).click()
    let add = page.getByRole('dialog', { name: 'Add to menu', exact: true })
    await add.getByRole('button', { name: 'A website', exact: true }).click()
    await add.getByLabel(/^Menu label/).fill('[Cancelled link]')
    await add.getByLabel(/^Web address/).fill('/cancelled')
    await capture(page, 'add-website', info.project.name)
    await page.keyboard.press('Escape')
    await expect(add).toHaveCount(0)
    await expect(menu.getByRole('listitem')).toHaveCount(count)
    await expect(menu.getByText('[Cancelled link]', { exact: true })).toHaveCount(0)
    await menu.getByRole('button', { name: 'Add to menu', exact: true }).click()
    add = page.getByRole('dialog', { name: 'Add to menu', exact: true })
    await add.getByRole('button', { name: 'A dropdown group', exact: true }).click()
    await add.getByLabel(/^Menu label/).fill('[New dropdown]')
    await add
      .getByLabel(/^First page in this dropdown/)
      .fill((await add.locator('datalist option').first().getAttribute('value'))!)
    await add.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(menu.getByRole('button', { name: '[New dropdown]', exact: true })).toBeVisible()
    await menu.getByRole('button', { name: 'Add to menu', exact: true }).click()
    add = page.getByRole('dialog', { name: 'Add to menu', exact: true })
    await add.getByRole('button', { name: 'A website', exact: true }).click()
    await add.getByLabel(/^Menu label/).fill('[New website]')
    await add.getByLabel(/^Web address/).fill('https://example.org/visit')
    await add.getByRole('button', { name: 'Done', exact: true }).click()
    await menu.getByRole('button', { name: 'Actions for [New website]', exact: true }).click()
    await menu.getByRole('button', { name: 'Move under previous item', exact: true }).click()
    await expect(menu.locator('li[data-nested]').filter({ hasText: '[New website]' })).toHaveCount(1)
    await capture(page, 'nested', info.project.name)
    await page.getByRole('tab', { name: 'Logo', exact: true }).click()
    await expect
      .poll(() =>
        page
          .getByRole('region', { name: 'Logo', exact: true })
          .locator('img')
          .evaluate(image => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0)
    await capture(page, 'logo', info.project.name)
    await page.getByRole('button', { name: 'Replace', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toBeVisible()
    await capture(page, 'logo-picker', info.project.name)
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Replace', exact: true }).click()
    await picker.getByRole('listbox', { name: 'Available images', exact: true }).getByRole('option').first().click()
    await picker.getByLabel('Image description', { exact: true }).fill('[Chosen logo description]')
    await picker.getByRole('button', { name: 'Use this logo', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Use the Salvation Army shield', exact: true })).toBeVisible()
    await capture(page, 'logo-choice', info.project.name)
    await page.getByRole('button', { name: 'Use the Salvation Army shield', exact: true }).click()
    await page.getByLabel(/^Description \(for screen readers\)/).fill('[Reviewed logo description]')
    await page.getByRole('tab', { name: 'Header buttons', exact: true }).click()
    const donate = page.getByRole('region', { name: 'Donate button', exact: true })
    await donate.getByRole('button', { name: 'A website', exact: true }).click()
    await donate.getByLabel(/^Web address/).fill('https://example.org/give?form=main#donate')
    await donate.getByLabel('Tracking code', { exact: true }).fill('utm_source=site')
    await page.getByLabel('Show second button', { exact: true }).check()
    const second = page.getByRole('region', { name: 'Second button', exact: true })
    await second.getByLabel(/^Label/).fill('[Find help]')
    await second.getByRole('button', { name: 'A website', exact: true }).click()
    await second.getByLabel(/^Web address/).fill('/help')
    await page.getByLabel('Show second button', { exact: true }).uncheck()
    await capture(page, 'buttons', info.project.name)
    const before = (
      await f.pool.query(
        'SELECT kind,draft_version_id,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY kind',
        [f.siteId],
      )
    ).rows
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Header & menu draft saved.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    const after = (
      await f.pool.query(
        'SELECT g.kind,g.draft_version_id,g.published_version_id,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
        [f.siteId],
      )
    ).rows
    for (const row of after)
      expect(row.published_version_id).toBe(before.find(item => item.kind === row.kind).published_version_id)
    expect(after.find(item => item.kind === 'footer').draft_version_id).toBe(
      before.find(item => item.kind === 'footer').draft_version_id,
    )
    const saved = after.find(item => item.kind === 'header').content
    expect(saved.component.values.logo.alt).toBe('[Reviewed logo description]')
    expect(saved.component.values.donate.trackingCode).toBe('utm_source=site')
    expect(saved.component.values.secondary).toBeUndefined()
    await page.reload()
    await page.getByRole('tab', { name: 'Header buttons', exact: true }).click()
    await expect(donate.getByLabel('Tracking code', { exact: true })).toHaveValue('utm_source=site')
    await expect(page.getByLabel('Show second button', { exact: true })).not.toBeChecked()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Preview header & menu', exact: true })
    await expect(
      page.frameLocator('iframe[title="Header on the full page"]').locator('header .national-brand img'),
    ).toBeVisible()
    await expect(preview.getByText('Opening preview…', { exact: true })).toHaveCount(0)
    await capture(page, 'preview', info.project.name)
    await preview.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('link', { name: 'Publish…', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/sites/' + f.siteId + '/publishing'))
    await expect(page).toHaveURL(/area=header-menu$/)
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2)
    for (const row of await page.getByRole('row').all()) {
      if (await row.getByText('Page', { exact: true }).count())
        await expect(row.getByRole('checkbox')).not.toBeChecked()
    }
    await capture(page, 'publish-scope', info.project.name)
    await expect(page.getByRole('heading', { name: 'Publish', level: 1, exact: true })).toBeVisible()
  } finally {
    f.client.release()
    await f.pool.end()
    for (const key of objects) await store.remove(key)
  }
})
test('Editors have no Header & menu navigation or route access', async ({ page }, info) => {
  const f = await sawsoFixture(true, true)
  try {
    const user = (await f.pool.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [user, f.siteId, 'editor'])
    await f.client.query('COMMIT')
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.siteId)
    await expect(page.getByRole('link', { name: 'Header & menu', exact: true })).toHaveCount(0)
    const response = await page.goto('/sites/' + f.siteId + '/header')
    expect(response?.status()).toBe(404)
    await capture(page, 'editor-no-access', info.project.name)
  } finally {
    f.client.release()
    await f.pool.end()
  }
})

test('an earlier header keeps full and compact logo choices in Header & menu without publishing its draft', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(true),
    store = createFilesystemMediaStore(defaultMediaRoot()),
    objects: string[] = []
  try {
    const mediaId = randomUUID(),
      bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.site,
          uploadObjectKey: 'preset-logo/input.png',
          finalKeyPrefix: 'preset-logo/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      original = processed.original
    for (const file of [original, ...processed.variants]) {
      await store.put(file.objectKey, file.data, file.mimeType)
      objects.push(file.objectKey)
    }
    await f.client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'[Preset logo fixture].png','[Sample logo]',$5,$6,$7,$8,'ready')",
      [
        mediaId,
        f.site,
        original.objectKey,
        original.sha256,
        original.width,
        original.height,
        original.bytes,
        original.mimeType,
      ],
    )
    for (const file of processed.variants)
      await f.client.query(
        'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [mediaId, file.kind, file.objectKey, file.sha256, file.width, file.height, file.bytes, file.mimeType],
      )
    const before = (
      await f.pool.query(
        'SELECT kind,draft_version_id,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY kind',
        [f.site],
      )
    ).rows
    const oldHeader = (
      await f.pool.query('SELECT content FROM global_element_versions WHERE id=$1', [
        before.find(row => row.kind === 'header').draft_version_id,
      ])
    ).rows[0].content
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/header')
    await page.getByRole('tab', { name: 'Logo', exact: true }).click()
    await page.getByRole('button', { name: 'Choose full logo', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker
      .getByRole('listbox', { name: 'Available images', exact: true })
      .getByRole('option')
      .filter({ hasText: '[Preset logo fixture].png' })
      .click()
    await picker.getByRole('button', { name: 'Use as full logo', exact: true }).click()
    const description = page.getByRole('textbox', { name: /^Description \(for screen readers\)/ })
    await expect(description).toBeVisible()
    await description.fill('')
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    await expect(page.getByRole('alert').filter({ hasText: 'Add a description for the logo.' })).toBeVisible()
    await description.fill('[Preset logo description]')
    await page.getByRole('textbox', { name: /^Site name/ }).fill('')
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    await page.getByRole('textbox', { name: /^Site name/ }).fill('[Preset logo name]')
    await page.getByRole('checkbox', { name: 'Show site name beside the logo', exact: true }).uncheck()
    const preview = page.frameLocator('iframe[title="Header preview"]')
    await expect(preview.locator('header img[alt="[Preset logo description]"]')).toBeVisible()
    await capture(page, 'preset-full-logo', info.project.name)
    await page.getByText('A different logo on phones', { exact: true }).click()
    await page.getByRole('button', { name: 'Choose compact logo', exact: true }).click()
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Header & menu draft saved.' })).toBeVisible()
    const after = (
      await f.pool.query(
        'SELECT g.kind,g.draft_version_id,g.published_version_id,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
        [f.site],
      )
    ).rows
    for (const row of after)
      expect(row.published_version_id).toBe(before.find(item => item.kind === row.kind).published_version_id)
    await page.getByRole('tab', { name: 'Header buttons', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Logos', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Displayed site name', { exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Logo', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Change full logo', exact: true })).toBeVisible()
    expect(after.find(row => row.kind === 'footer').draft_version_id).toBe(
      before.find(row => row.kind === 'footer').draft_version_id,
    )
    expect(after.find(row => row.kind === 'header').content.brand).toMatchObject({
      siteName: '[Preset logo name]',
      logoMediaId: mediaId,
      compactLogoMediaId: null,
      showName: false,
      logoDescription: '[Preset logo description]',
    })
    expect(
      (
        await f.pool.query('SELECT content FROM global_element_versions WHERE id=$1', [
          before.find(row => row.kind === 'header').draft_version_id,
        ])
      ).rows[0].content,
    ).toEqual(oldHeader)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
    for (const key of objects) await store.remove(key)
  }
})
