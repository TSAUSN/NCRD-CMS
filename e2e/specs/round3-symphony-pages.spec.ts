import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('native Pages groups sectors, finds stories, saves shared link drafts and creates private pages or website links', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/symphony-pages/' + info.project.name)
  await mkdir(folder, { recursive: true })
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    const people = (
      await f.pool.query(
        "SELECT id,email FROM app_users WHERE email IN ('contributor@example.test','editor@example.test')",
      )
    ).rows
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    for (const person of people)
      await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [
        person.id,
        f.siteId,
        person.email.startsWith('contributor') ? 'site_admin' : 'editor',
      ])
    await f.client.query('COMMIT')
    // Establish the existing live fixture through the normal publication commands.
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const theme = (await f.client.query('SELECT revision FROM themes WHERE site_id=$1', [f.siteId])).rows[0]!,
      frameHeads = (await f.client.query('SELECT kind,revision FROM global_elements WHERE site_id=$1', [f.siteId])).rows
    await f.client.query('SELECT app.publish_theme($1,$2)', [f.siteId, theme.revision])
    await f.client.query('SELECT app.publish_global_elements($1,$2,$3)', [
      f.siteId,
      frameHeads.find(row => row.kind === 'header')!.revision,
      frameHeads.find(row => row.kind === 'footer')!.revision,
    ])
    for (const list of (
      await f.client.query('SELECT id,revision,entry_revision FROM collections WHERE site_id=$1', [f.siteId])
    ).rows) {
      await f.client.query('SELECT app.publish_collection_schema($1,$2)', [list.id, list.revision])
      await f.client.query('SELECT app.publish_collection_entries($1,$2)', [list.id, list.entry_revision])
    }
    for (const p of (
      await f.client.query(
        'SELECT id,revision FROM pages WHERE site_id=$1 AND draft_version_id IS NOT NULL ORDER BY slug',
        [f.siteId],
      )
    ).rows)
      await f.client.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [p.id, p.revision])
    const navigation = (await f.client.query('SELECT revision FROM navigations WHERE site_id=$1', [f.siteId])).rows[0]!
    await f.client.query('SELECT app.publish_navigation($1,$2)', [f.siteId, navigation.revision])
    await f.client.query('COMMIT')
    const before = (
        await f.pool.query('SELECT id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [f.siteId])
      ).rows,
      home = (await f.pool.query("SELECT id,title FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!,
      story = (
        await f.pool.query(
          "SELECT e.id,v.values->>'title' AS title FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.site_id=$1 AND c.reader_key='stories' AND e.archived_at IS NULL ORDER BY e.id LIMIT 1",
          [f.siteId],
        )
      ).rows[0]!,
      heads = async () =>
        (
          await f.pool.query(
            'SELECT id,published_version_id FROM navigations WHERE site_id=$1 UNION ALL SELECT id,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY id',
            [f.siteId],
          )
        ).rows,
      liveBefore = await heads()
    await signIn(page, 'contributor@example.test')
    await page.goto('/sites/' + f.siteId + '/pages')
    await expect(page.getByRole('heading', { name: 'Pages', level: 1, exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ways We Help 8', exact: true })).toBeVisible()
    await capture('main')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      const table = page.getByRole('table', { name: 'Pages', exact: true })
      expect(await table.evaluate(node => node.scrollWidth <= node.parentElement!.clientWidth)).toBe(true)
      for (const time of await table.locator('time').all())
        expect((await time.boundingBox())!.height).toBeLessThanOrEqual(20)
      await expect(table.getByRole('link', { name: home.title, exact: true })).toHaveAttribute(
        'href',
        '/pages/' + home.id,
      )
      await expect(table.getByRole('link', { name: 'Edit ' + home.title, exact: true })).toHaveCount(0)
      const homeRow = table.getByRole('row').filter({ has: page.getByRole('link', { name: home.title, exact: true }) })
      await homeRow.getByRole('button', { name: 'More actions for ' + home.title, exact: true }).click()
      await expect(page.getByRole('link', { name: 'Edit ' + home.title, exact: true })).toBeVisible()
      await expect(
        page.getByRole('link', { name: 'View ' + home.title + ' on the live site', exact: true }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      expect(
        await homeRow
          .locator('td')
          .last()
          .evaluate(
            e =>
              e.getBoundingClientRect().right <= e.closest('table')!.parentElement!.getBoundingClientRect().right + 1,
          ),
      ).toBe(true)
      await expect(page.getByLabel('Search pages and stories', { exact: true })).toHaveAttribute('type', 'search')
    }
    await capture('compact-main-rows')
    await page.getByLabel('Search pages and stories', { exact: true }).fill(story.title)
    await expect(page.getByRole('link', { name: 'Edit story', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + f.siteId + '/stories/' + story.id,
    )
    await capture('story-search')
    await page.getByRole('link', { name: 'Edit story', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/stories/' + story.id + '$'))
    await page.goto('/sites/' + f.siteId + '/pages')
    const stale = await page.context().newPage()
    await stale.goto('/sites/' + f.siteId + '/pages')
    await expect(stale.getByRole('switch', { name: home.title + ' in the menu', exact: true })).toBeVisible()
    const menuSwitch = page.getByRole('switch', { name: home.title + ' in the menu', exact: true }),
      menuWas = await menuSwitch.isChecked()
    await menuSwitch.click()
    await expect(menuSwitch).toBeChecked({ checked: !menuWas })
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible()
    expect(await heads()).toEqual(liveBefore)
    const footerSwitch = page.getByRole('switch', { name: home.title + ' in the footer', exact: true }),
      footerWas = await footerSwitch.isChecked()
    await footerSwitch.click()
    await expect(footerSwitch).toBeChecked({ checked: !footerWas })
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible()
    expect(await heads()).toEqual(liveBefore)
    const footerBeforeStale = (
      await f.pool.query("SELECT draft_version_id FROM global_elements WHERE site_id=$1 AND kind='footer'", [f.siteId])
    ).rows[0]!.draft_version_id
    let stalePinned = false
    await stale.route('**/sites/' + f.siteId + '/pages*', async r => {
      const data = r.request().postData()
      if (r.request().method() === 'POST' && data?.includes('controls')) {
        stalePinned = true
        await r.continue({ postData: data.replace(/"menuRevision":\d+/, '"menuRevision":0') })
      } else await r.continue()
    })
    await stale.getByRole('switch', { name: home.title + ' in the footer', exact: true }).click()
    await expect.poll(() => stalePinned).toBe(true)
    await expect(stale.getByRole('alert').filter({ hasText: 'Someone else saved' })).toContainText(
      'Someone else saved the menu or footer',
    )
    expect(
      (
        await f.pool.query("SELECT draft_version_id FROM global_elements WHERE site_id=$1 AND kind='footer'", [
          f.siteId,
        ])
      ).rows[0]!.draft_version_id,
    ).toBe(footerBeforeStale)
    await stale.close()
    await capture('shared-drafts')
    const foreign = (
        await f.pool.query(
          "SELECT p.id,p.draft_version_id,p.published_version_id FROM pages p JOIN sites s ON s.id=p.site_id WHERE s.slug='demo' ORDER BY p.id LIMIT 1",
        )
      ).rows[0]!,
      route = '**/sites/' + f.siteId + '/pages*'
    let tampered = false
    await page.route(route, async r => {
      const body = r.request().postData()
      if (r.request().method() === 'POST' && body?.includes('pageId')) {
        tampered = true
        await r.continue({ postData: body.replaceAll(home.id, foreign.id) })
      } else await r.continue()
    })
    await menuSwitch.click()
    await expect.poll(() => tampered).toBe(true)
    await expect(page.getByRole('alert').filter({ hasText: 'Choose a page on this site' })).toContainText(
      'Choose a page on this site',
    )
    expect(
      (await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE id=$1', [foreign.id]))
        .rows[0],
    ).toEqual(foreign)
    await page.unroute(route)
    await page.reload()
    await page.getByRole('button', { name: 'Ways We Help 8', exact: true }).click()
    await expect(page.getByRole('table', { name: 'Pages', exact: true }).getByRole('row')).toHaveCount(9)
    const rows = page.getByRole('table', { name: 'Pages', exact: true }).getByRole('row'),
      first = rows.nth(1),
      second = rows.nth(2),
      firstName = await first.getByRole('link').first().innerText(),
      secondName = await second.getByRole('link').first().innerText()
    if (info.project.name === 'chromium')
      await second.getByRole('button', { name: 'Move ' + secondName, exact: true }).dragTo(first)
    else {
      await second.getByRole('button', { name: 'Move ' + secondName, exact: true }).focus()
      await page.keyboard.press('ArrowUp')
    }
    await expect(rows.nth(1).getByRole('link').first()).toHaveText(secondName)
    await expect(rows.nth(2).getByRole('link').first()).toHaveText(firstName)
    await capture('sectors-reordered')
    expect(await heads()).toEqual(liveBefore)
    await page.goto('/sites/' + f.siteId + '/header')
    await expect(page.getByRole('region', { name: 'Main menu', exact: true })).toContainText(home.title)
    await page.goto('/sites/' + f.siteId + '/footer')
    await expect(page.getByRole('heading', { name: 'Footer', level: 1, exact: true })).toBeVisible()
    await page.goto('/sites/' + f.siteId + '/publishing')
    const ready = page.getByRole('region', { name: 'Changes ready to publish', exact: true })
    await expect(ready).toContainText('Menu: reordered ')
    await expect(ready).toContainText('Menu: ' + (menuWas ? 'removed ' : 'added ') + home.title)
    await expect(ready).toContainText('Footer: ' + (footerWas ? 'removed ' : 'added ') + home.title)
    await capture('ready-plain-words')
    for (const box of await ready.getByRole('checkbox').all()) if (await box.isChecked()) await box.uncheck()
    await ready.getByRole('checkbox', { name: /^Menu/ }).check()
    await ready.getByRole('checkbox', { name: /^Header & footer/ }).check()
    await page.getByRole('button', { name: 'Publish selected (2)', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
      timeout: 60000,
    })
    const samples = page.getByRole('checkbox', { name: /Publish with sample content/ })
    if (await samples.isVisible()) await samples.check()
    const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
    if (await reason.isVisible())
      await reason.fill(
        'Local review of the named menu and footer changes; existing approved page content is preserved.',
      )
    await page.getByRole('button', { name: 'Publish selected (2)', exact: true }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Publish selected changes?', exact: true })
    await expect(confirm).toBeVisible()
    await capture('publish-review')
    await confirm.getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 90000 })
    expect(await heads()).not.toEqual(liveBefore)
    expect(
      (await f.pool.query('SELECT id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [f.siteId])).rows,
    ).toEqual(before)
    await page.goto('/sites/' + f.siteId + '/pages')
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'New page', exact: true })
    await dialog.getByLabel('Page title', { exact: true }).fill('[Cancelled draft]')
    await page.keyboard.press('Escape')
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(dialog.getByLabel('Page title', { exact: true })).toHaveValue('[Cancelled draft]')
    await capture('new-page')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    expect((await f.pool.query('SELECT count(*)::int AS n FROM pages WHERE site_id=$1', [f.siteId])).rows[0]!.n).toBe(
      before.length,
    )
    for (const mode of ['blank', 'design', 'copy'] as const) {
      await page.getByRole('button', { name: 'New page', exact: true }).click()
      dialog = page.getByRole('dialog', { name: 'New page', exact: true })
      await dialog.getByLabel('Page title', { exact: true }).fill('[Private ' + mode + ']')
      await expect(dialog.getByLabel('Page title', { exact: true })).toHaveAttribute('maxlength', '90')
      await dialog.getByLabel('Description for search', { exact: true }).fill('[Private description]')
      await expect(dialog.getByLabel('Description for search', { exact: true })).toHaveAttribute('maxlength', '155')
      await dialog.getByRole('button', { name: 'Change', exact: true }).click()
      await dialog.getByLabel('Web address', { exact: true }).fill('private-' + mode)
      if (mode === 'design') await dialog.getByText('A page design', { exact: true }).click()
      if (mode === 'copy') {
        await dialog.getByText('A copy of a page', { exact: true }).click()
        await dialog.getByLabel('Page to copy', { exact: true }).selectOption(home.id)
      }
      await expect(dialog.getByRole('checkbox', { name: /Add to the menu/ })).not.toBeChecked()
      if (mode === 'blank') await dialog.getByRole('checkbox', { name: /Add to the menu/ }).check()
      await dialog.getByRole('button', { name: 'Create draft', exact: true }).click()
      await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
      const id = new URL(page.url()).pathname.split('/').at(-1),
        created = (
          await f.pool.query(
            'SELECT p.published_version_id,p.slug,v.meta,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [id],
          )
        ).rows[0]!
      expect(created.published_version_id).toBeNull()
      expect(created.slug).toBe('private-' + mode)
      expect(created.meta.description).toBe('[Private description]')
      expect(created.meta.title).toBe('[Private ' + mode + ']')
      if (mode === 'copy')
        expect(created.content).toEqual(
          (
            await f.pool.query(
              'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
              [home.id],
            )
          ).rows[0]!.content,
        )
      await page.goto('/sites/' + f.siteId + '/pages')
    }
    const count = (await f.pool.query('SELECT count(*)::int n FROM pages WHERE site_id=$1', [f.siteId])).rows[0]!.n
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'New page', exact: true })
    await dialog.getByLabel('Page title', { exact: true }).fill('[Website link]')
    await dialog.getByText('A link to another website', { exact: true }).click()
    await dialog.getByLabel('Website address', { exact: true }).fill('https://example.org/approved-path')
    await capture('website-link')
    await dialog.getByRole('button', { name: 'Add to menu draft', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Website link added to the menu draft')
    expect((await f.pool.query('SELECT count(*)::int n FROM pages WHERE site_id=$1', [f.siteId])).rows[0]!.n).toBe(
      count,
    )
    expect(
      JSON.stringify(
        (
          await f.pool.query(
            'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
            [f.siteId],
          )
        ).rows[0]!.tree,
      ),
    ).toContain('https://example.org/approved-path')
    const editorContext = await browser.newContext()
    try {
      const editor = await editorContext.newPage()
      await signIn(editor, 'editor@example.test')
      await editor.goto('/sites/' + f.siteId + '/pages')
      await expect(editor.getByRole('switch')).toHaveCount(0)
      await expect(editor.getByRole('link', { name: 'Edit menu', exact: true })).toHaveCount(0)
      await editor.getByRole('button', { name: 'New page', exact: true }).click()
      await expect(editor.getByRole('radio', { name: /A link to another website/ })).toHaveCount(0)
      await expect(editor.getByRole('checkbox', { name: /Add to the menu/ })).toHaveCount(0)
    } finally {
      await editorContext.close()
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
