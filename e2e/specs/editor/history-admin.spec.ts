import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('native History keeps exact version previews, readable comparisons, filtering and draft-only restore', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    pageId = f.pages[0]!,
    folder = resolve('../.r8-progress/round3/history-admin/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const c = await f.pool.connect()
    let older = '',
      latest = ''
    try {
      const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
      for (const heading of ['[Earlier saved heading]', '[Current saved heading]']) {
        const row = (
            await c.query(
              'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
              [pageId],
            )
          ).rows[0]!,
          content = structuredClone(row.content)
        content[0].values.heading = heading
        const saved = (
          await c.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
            pageId,
            row.revision,
            JSON.stringify(content),
            JSON.stringify(row.meta),
            '[Saved heading change]',
          ])
        ).rows[0]!
        if (!older) older = saved.version_id
        else latest = saved.version_id
      }
      await c.query('COMMIT')
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
    const before = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE id=$1', [pageId])
      ).rows[0]!,
      versions = (await f.pool.query('SELECT * FROM page_versions WHERE page_id=$1 ORDER BY id', [pageId])).rows
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
        await page.evaluate(() => document.fonts.ready)
        await page
          .getByRole('heading', { name: 'Page history', exact: true })
          .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
        if (name === 'superadmin-fields')
          await page
            .getByText('All saved fields', { exact: true })
            .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + pageId + '/history')
    const selected = page.frameLocator('iframe[title^="Preview of version"]'),
      comparison = page.frameLocator('iframe[title^="Comparison preview of version"]')
    await expect(selected.getByRole('heading', { name: '[Current saved heading]', exact: true })).toBeVisible()
    await capture('current')
    await page
      .getByRole('complementary', { name: 'Versions', exact: true })
      .getByRole('link')
      .filter({ hasText: 'Version ' + versions.find(v => v.id === older)!.revision })
      .click()
    await expect(selected.getByRole('heading', { name: '[Earlier saved heading]', exact: true })).toBeVisible()
    await expect(comparison.getByRole('heading', { name: '[Current saved heading]', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'What changed', exact: true })).toContainText('Welcome · Heading')
    await expect(page.getByRole('region', { name: 'What changed', exact: true })).not.toContainText('section_def_id')
    await expect(page.getByText('All saved fields', { exact: true })).toHaveCount(0)
    await expect(page.locator('iframe[title^="Preview of version"]')).toHaveAttribute('sandbox', 'allow-same-origin')
    await capture('compare')
    await page.getByRole('button', { name: 'Show only changes', exact: true }).click()
    await expect(page.locator('iframe')).toHaveCount(0)
    await capture('only-changes')
    await page.getByRole('button', { name: 'Show page previews', exact: true }).click()
    await page.getByRole('combobox', { name: 'Filter versions by author', exact: true }).selectOption('you')
    await expect(page.getByText('No loaded versions match these filters.', { exact: true })).toBeVisible()
    await capture('filtered-empty')
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await page.getByText('Compare with another version', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Compare versions', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Close comparison', exact: true }).click()
    await expect(page.locator('iframe')).toHaveCount(1)
    await page.getByRole('link', { name: 'Show automatic saves', exact: true }).click()
    await expect(page.locator('iframe')).toHaveCount(1)
    await page.getByRole('link', { name: 'Hide automatic saves', exact: true }).click()
    const foreign = await page.evaluate(
      async url => (await fetch(url)).status,
      '/pages/' +
        pageId +
        '/history?version=' +
        before.published_version_id +
        '&compare=00000000-0000-4000-8000-000000000099',
    )
    expect(foreign).toBe(404)
    await page.getByRole('button', { name: 'Restore as new draft', exact: true }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Create a new draft from this version?', exact: true })
    await expect(confirm).toContainText('The live page will not change.')
    await capture('restore-confirm')
    await confirm.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/pages/' + pageId + '$'))
    const restored = (
      await f.pool.query('SELECT draft_version_id,published_version_id,revision FROM pages WHERE id=$1', [pageId])
    ).rows[0]!
    expect(restored.published_version_id).toBe(before.published_version_id)
    expect(restored.draft_version_id).not.toBe(older)
    expect(Number(restored.revision)).toBe(Number(before.revision) + 1)
    expect(
      (await f.pool.query('SELECT content FROM page_versions WHERE id=$1', [restored.draft_version_id])).rows[0]!
        .content,
    ).toEqual(versions.find(v => v.id === older)!.content)
    expect(
      (
        await f.pool.query('SELECT * FROM page_versions WHERE id=ANY($1::uuid[]) ORDER BY id', [
          versions.map(v => v.id),
        ])
      ).rows,
    ).toEqual(versions)
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + pageId + '/history?version=' + latest)
    await page.getByText('All saved fields', { exact: true }).click()
    await expect(page.getByRole('rowheader', { name: 'Position 1 · heading', exact: true })).toBeVisible()
    await capture('superadmin-fields')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
