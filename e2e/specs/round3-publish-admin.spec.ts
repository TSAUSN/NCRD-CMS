import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'

test('native Publish shows factual saved rows and keeps review, publication and scheduling distinct', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    id = f.pages[0]!,
    folder = resolve('../.r8-progress/round3/publish-admin/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const c = await f.pool.connect()
    try {
      const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const row = (
          await c.query(
            'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [id],
          )
        ).rows[0]!,
        content = structuredClone(row.content)
      content[0].values.heading = '[Reviewed Publish heading]'
      await c.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','[Publish comparison]')", [
        id,
        row.revision,
        JSON.stringify(content),
        JSON.stringify(row.meta),
      ])
      await c.query('COMMIT')
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
    const before = (await f.pool.query('SELECT published_version_id,draft_version_id FROM pages WHERE id=$1', [id]))
        .rows[0]!,
      base = '/sites/' + f.site + '/publishing'
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
        await page.evaluate(() => document.fonts.ready)
        await page
          .getByRole('heading', { name: 'Publish', level: 1, exact: true })
          .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const ready = page.getByRole('table', { name: 'Saved changes ready to publish', exact: true })
        if (await ready.isVisible()) {
          expect(
            await ready
              .getByRole('columnheader', { name: 'Who', exact: true })
              .evaluate(n => n.getBoundingClientRect().width),
          ).toBeGreaterThanOrEqual(140)
          expect(
            await ready
              .locator('tbody td:nth-child(4) span')
              .evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1)),
          ).toBe(true)
        }
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    const table = page.getByRole('table', { name: 'Saved changes ready to publish', exact: true }),
      row = table.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Welcome', exact: true }) })
    await expect(page.getByRole('tab', { name: 'Changes ready to publish', exact: true })).toHaveText('Ready 1')
    await expect(row).toContainText('Welcome: changed heading')
    await expect(row).toContainText('You')
    await expect(row.locator('time')).toHaveAttribute('datetime', /T/)
    await expect(page.getByRole('main').getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish selected (1)', exact: true })).toHaveCount(1)
    await capture('ready')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(row.getByRole('rowheader', { name: 'Welcome Page', exact: true })).toBeInViewport()
    expect(
      await table
        .getByRole('columnheader', { name: 'What', exact: true })
        .evaluate(node => node.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(120)
    await expect(row.getByRole('button', { name: 'View changes', exact: true })).toBeInViewport()
    await expect(table.getByRole('columnheader', { name: 'Who', exact: true })).toBeHidden()
    await expect(table.getByRole('columnheader', { name: 'When', exact: true })).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, 'ready-390.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await row.getByRole('checkbox').uncheck()
    await expect(page.getByRole('button', { name: 'Publish selected (0)', exact: true })).toBeDisabled()
    await row.getByRole('checkbox').check()
    await row.getByRole('button', { name: 'View changes', exact: true }).click()
    const compare = page.getByRole('dialog', { name: 'Changes to Welcome', exact: true })
    await expect(compare).toContainText('[Reviewed Publish heading]')
    await compare.getByRole('button', { name: /Close/ }).click()
    await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
    ).toBe(before.published_version_id)
    await capture('review')
    await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Publish selected changes?', exact: true })
    await expect(confirm).toContainText('What’s changing')
    await capture('confirm')
    await confirm.getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
    ).toBe(before.draft_version_id)
    await page.goto(base)
    await expect(page.getByRole('heading', { name: 'Everything saved is live', exact: true })).toBeVisible()
    await capture('empty-ready')
    await page.getByRole('tab', { name: 'Scheduled publishing', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Scheduled publishing', exact: true })).toBeVisible()
    await capture('scheduled')
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await expect(page.getByText('Went live', { exact: true })).toBeVisible()
    await capture('history')
    const archive = await f.pool.connect()
    try {
      await archive.query('BEGIN')
      const root = (await archive.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await archive.query("SELECT set_config('app.user_id',$1,true)", [root])
      await archive.query('SELECT app.archive_site(id,revision) FROM sites WHERE id=$1', [f.site])
      await archive.query('COMMIT')
    } catch (error) {
      await archive.query('ROLLBACK')
      throw error
    } finally {
      archive.release()
    }
    await page.goto(base)
    await expect(page.getByRole('status').filter({ hasText: 'This site is archived.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No changes can be published', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Publish selected/ })).toHaveCount(0)
    await expect(page.getByRole('status').getByRole('link', { name: 'History', exact: true })).toBeVisible()
    await capture('archived')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
