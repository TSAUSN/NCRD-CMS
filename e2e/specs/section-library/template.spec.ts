import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { reserveSawsoSlug, sawsoFixture } from '../fixtures/sawso.ts'
import { echelonFixture } from '../fixtures/echelon.ts'
import { signIn } from '../helpers.ts'
test('Super admin reviews template drafts and starts a private shared-section copy; Cancel creates nothing', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true),
    alternate = await echelonFixture(true),
    created: string[] = []
  let restoreSlug: (() => Promise<void>) | undefined
  try {
    restoreSlug = await reserveSawsoSlug(f.pool, f.siteId)
    await f.pool.query('UPDATE sites SET name=$2 WHERE id=$1', [f.siteId, '[Template review primary]'])
    await f.pool.query('UPDATE sites SET name=$2 WHERE id=$1', [alternate.site, '[Template review alternate]'])
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const retired = (
      await f.client.query("SELECT app.create_page($1,'retired-copy-page','[Archived source page]') AS id", [f.siteId])
    ).rows[0]!.id
    await f.client.query('SELECT app.archive_page($1,0)', [retired])
    const head = (
      await f.client.query(
        'SELECT h.revision,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [f.siteId],
      )
    ).rows[0]!
    delete head.tokens.presentation.template
    await f.client.query('SELECT app.save_theme_draft($1,$2,$3)', [
      f.siteId,
      head.revision,
      JSON.stringify(head.tokens),
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/template')
    await expect(page.getByRole('heading', { name: 'National template', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    const folder = resolve('../.r8-progress/round3/template-preview-target', info.project.name)
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'template-' + width + '.png'), fullPage: true })
    }
    const before = Number((await f.pool.query('SELECT count(*) AS count FROM sites')).rows[0]!.count)
    await page.getByRole('button', { name: 'Start a site from this', exact: true }).click()
    await page.getByLabel(/^Site name/).fill('[Private site]')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    expect(Number((await f.pool.query('SELECT count(*) AS count FROM sites')).rows[0]!.count)).toBe(before)
    await page.getByRole('button', { name: 'Review an update', exact: true }).click()
    const review = page.getByRole('dialog')
    const scopes = review.getByRole('list', { name: 'Sites in this update', exact: true })
    const names = (
      await f.pool.query<{ name: string }>('SELECT name FROM sites WHERE id=ANY($1::uuid[])', [
        [f.siteId, alternate.site],
      ])
    ).rows.map(row => row.name)
    expect(new Set(names).size).toBe(2)
    // The full suite can leave other eligible demo sites. Both explicit fixtures
    // must be offered; only the current site may be selected by default.
    for (const name of names) await expect(scopes.getByRole('checkbox', { name, exact: true })).toBeVisible()
    await expect(scopes.locator('input:checked')).toHaveCount(1)
    expect(await scopes.locator('summary').count()).toBe(await scopes.locator(':scope>li').count())
    for (const disclosure of await scopes.locator('details').all())
      await expect(disclosure).not.toHaveAttribute('open', '')
    const labels = await scopes
      .locator(':scope>li label')
      .evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().x))
    expect(new Set(labels).size).toBe(1)
    await scopes.locator('summary').first().click()
    await expect(scopes.locator('details').first()).toHaveAttribute('open', '')
    await scopes.locator('summary').first().click()
    const previewOn = review.getByLabel('Preview on', { exact: true }),
      createDrafts = review.getByRole('button', { name: 'Create drafts on 1 site', exact: true })
    await expect(previewOn).toHaveValue(f.siteId)
    await expect(createDrafts).toBeEnabled()
    await expect(previewOn.locator('option[value="' + alternate.site + '"]')).toHaveCount(1)
    const otherHeads = (
      await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
        alternate.site,
      ])
    ).rows
    await previewOn.selectOption(alternate.site)
    await expect(review).toContainText('collection binding is missing, private, or belongs to another site')
    await expect(createDrafts).toBeDisabled()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'preview-refused-' + width + '.png'), fullPage: true })
    }
    await previewOn.selectOption(f.siteId)
    await expect(createDrafts).toBeEnabled()
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          alternate.site,
        ])
      ).rows,
    ).toEqual(otherHeads)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'review-' + width + '.png'), fullPage: true })
    }
    await review.getByRole('button', { name: 'Create drafts on 1 site', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Created drafts on 1 site')
    await page.getByRole('button', { name: 'Start a site from this', exact: true }).click()
    await page.getByLabel(/^Site name/).fill('[Private site]')
    await page.getByLabel(/^Test address/).fill('r3-private-copy')
    await page.getByLabel('Site to copy', { exact: true }).selectOption(f.siteId)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'start-' + width + '.png'), fullPage: true })
    }
    const sourceHeads = (
      await f.pool.query(
        'SELECT id,revision,draft_version_id,published_version_id,archived_at FROM pages WHERE site_id=$1 ORDER BY id',
        [f.siteId],
      )
    ).rows
    await page.getByRole('button', { name: 'Create private site', exact: true }).click()
    await expect(page).toHaveURL(/\/sites\/[a-f0-9-]{36}$/, { timeout: 60000 })
    const copy = page.url().split('/').at(-1)!
    created.push(copy)
    const state = (await f.pool.query('SELECT initial_release_required FROM sites WHERE id=$1', [copy])).rows[0]!
    expect(state.initial_release_required).toBe(true)
    expect(
      Number(
        (
          await f.pool.query(
            'SELECT count(*) AS count FROM pages WHERE site_id=$1 AND published_version_id IS NOT NULL',
            [copy],
          )
        ).rows[0]!.count,
      ),
    ).toBe(0)
    expect(
      (
        await f.pool.query("SELECT count(*)::int AS count FROM pages WHERE site_id=$1 AND slug='retired-copy-page'", [
          copy,
        ])
      ).rows[0]!.count,
    ).toBe(0)
    expect(
      (
        await f.pool.query(
          'SELECT id,revision,draft_version_id,published_version_id,archived_at FROM pages WHERE site_id=$1 ORDER BY id',
          [f.siteId],
        )
      ).rows,
    ).toEqual(sourceHeads)
    const editor = await browser.newContext()
    try {
      const view = await editor.newPage()
      await signIn(view, 'editor@example.test')
      await view.goto('/sites/' + f.siteId + '/template')
      await expect(view.getByRole('heading', { name: 'National template', exact: true })).toHaveCount(0)
    } finally {
      await editor.close()
    }
  } finally {
    await restoreSlug?.()
    for (const id of [f.siteId, alternate.site, ...created])
      await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [id])
    f.client.release()
    await f.pool.end()
    alternate.client.release()
    await alternate.pool.end()
  }
})
