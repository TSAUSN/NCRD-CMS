import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'

test('Lists opens saved records beside its rail and preserves private editing, index and unavailable states', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    base = '/sites/' + f.site + '/content',
    folder = resolve('../.r8-progress/round3/lists-admin/' + info.project.name)
  let listId = ''
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto(base)
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate(() => document.fonts.ready)
        const board = page.getByRole('region', { name: '[Resources A] records', exact: true }),
          commands = page.getByRole('region', { name: 'List publishing status', exact: true })
        if (await board.isVisible()) {
          await expect(commands).toBeInViewport()
          const rows = await board.boundingBox(),
            bar = await commands.boundingBox()
          expect(rows!.y + rows!.height).toBeLessThanOrEqual(bar!.y + 1)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page
          .getByRole('heading', { name: 'Lists', level: 1, exact: true })
          .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await expect(page.getByRole('heading', { name: 'Keep shared items in a list', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New list', exact: true })).toHaveCount(1)
    await capture('empty')
    await page.getByRole('button', { name: 'New list', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Create a list', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    const c = await f.pool.connect()
    try {
      await c.query('BEGIN')
      const root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query("SELECT set_config('app.user_id',$1,true)", [root])
      for (const [key, name] of [
        ['resources', '[Resources A]'],
        ['other_resources', '[Resources B]'],
      ]) {
        const list = (
          await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
            f.site,
            key!.replaceAll('_', '-'),
            name,
            key,
            JSON.stringify([
              { key: 'title', label: 'Resource title', type: 'text', required: true },
              { key: 'summary', label: 'Summary', type: 'text', required: false },
            ]),
            JSON.stringify({
              schemaVersion: 1,
              titleField: 'title',
              subtitleField: 'summary',
              imageField: null,
              groupField: null,
            }),
          ])
        ).rows[0]!
        if (key === 'resources') {
          listId = list.collection_id
          await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
            listId,
            JSON.stringify([
              { id: null, stableKey: 'one', values: { title: '[Resource one]', summary: '[First summary]' } },
              { id: null, stableKey: 'two', values: { title: '[Resource two]', summary: '[Second summary]' } },
            ]),
          ])
          await c.query('SELECT app.publish_collection_schema($1,1)', [listId])
          await c.query('SELECT * FROM app.publish_collection_entries($1,1)', [listId])
        }
      }
      await c.query('COMMIT')
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
    const heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      live = (
        await f.pool.query(
          'SELECT id,published_version_id FROM collection_entries WHERE collection_id=$1 ORDER BY id',
          [listId],
        )
      ).rows
    await page.goto(base)
    await expect(page.getByRole('heading', { name: '[Resources A]', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Site lists', exact: true })).toContainText('[Resources B]')
    await expect(page.getByRole('main').getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New list', exact: true })).toHaveCount(1)
    await expect(
      page.getByRole('list', { name: '[Resources A] items', exact: true }).getByRole('listitem'),
    ).toHaveCount(2)
    await capture('records')
    await page.getByRole('button', { name: 'Edit [Resource one]', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Edit resource', exact: true })
    await drawer.getByLabel('Resource title', { exact: false }).fill('[Private updated resource]')
    await capture('item')
    await drawer.getByRole('button', { name: 'Save resource', exact: true }).click()
    await expect(drawer).toBeHidden()
    await expect(page.getByRole('button', { name: 'Edit [Private updated resource]', exact: true })).toBeVisible()
    expect(
      (
        await f.pool.query(
          'SELECT id,published_version_id FROM collection_entries WHERE collection_id=$1 ORDER BY id',
          [listId],
        )
      ).rows,
    ).toEqual(live)
    await capture('saved-private')
    await page
      .getByRole('group', { name: 'List view', exact: true })
      .getByRole('button', { name: 'Cards', exact: true })
      .click()
    await capture('cards')
    await page
      .getByRole('navigation', { name: 'Site lists', exact: true })
      .getByRole('link', { name: 'All lists', exact: true })
      .click()
    await expect(page.getByRole('heading', { name: 'Your lists', exact: true })).toBeVisible()
    await capture('all-lists')
    await page.goto(base + '?collection=' + randomUUID())
    await expect(page.getByRole('status').filter({ hasText: 'That list is unavailable.' })).toBeVisible()
    await expect(page.getByRole('list', { name: '[Resources A] items', exact: true })).toHaveCount(0)
    await capture('unavailable')
    const context = await browser.newContext()
    try {
      const creator = await context.newPage()
      await signIn(creator, 'contributor@example.test')
      await creator.goto(base)
      await expect(creator.getByRole('button', { name: 'New list', exact: true })).toHaveCount(0)
      await expect(creator.getByRole('button', { name: 'Publish list', exact: true })).toHaveCount(0)
      await expect(creator.getByRole('button', { name: 'Edit [Private updated resource]', exact: true })).toBeVisible()
    } finally {
      await context.close()
    }
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
