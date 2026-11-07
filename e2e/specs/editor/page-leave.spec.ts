import { test, expect, type Page } from '@playwright/test'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { repeatItemKeys } from '@cms/schema'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
function pool() {
  return new Pool({
    connectionString: `postgres://cms:cms@127.0.0.1:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
}
async function capture(page: Page, folder: string, name: string) {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('page leave keeps an autosaved private draft, restores only this visit on discard, and refuses a stale restore', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const db = pool(),
    c = await db.connect(),
    folder = resolve('../.r8-progress/round3/page-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let id = ''
  try {
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      site = (await c.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id,
      def = (
        await c.query(
          "SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
        )
      ).rows[0]!,
      content = (heading: string) =>
        JSON.stringify([
          {
            section_def_id: def.id,
            section_def_version: def.version,
            values: { heading, intro: '[Keep introduction]' },
            label: 'Hero',
            hidden: false,
            hidden_at: [],
          },
        ])
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    id = (
      await c.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        'page-leave-' + randomUUID().slice(0, 8),
        '[Page leave]',
      ])
    ).rows[0]!.id
    await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      id,
      content('[Published heading]'),
      JSON.stringify({ description: '[Keep search description]', noindex: false }),
    ])
    await c.query("SELECT app.publish_page($1,1,2,NULL,'[]')", [id])
    await c.query('SELECT app.save_page_draft($1,2,$2,$3)', [
      id,
      content('[Opening private draft]'),
      JSON.stringify({ description: '[Keep search description]', noindex: false }),
    ])
    await c.query('COMMIT')
    const read = async () =>
        (
          await db.query(
            'SELECT p.revision,p.published_version_id,v.content,v.meta,(SELECT count(*)::int FROM page_versions WHERE page_id=p.id) AS versions FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [id],
          )
        ).rows[0]!,
      opening = await read()
    await signIn(page, 'editor@example.test')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/pages/' + id + '?section=0')
    const heading = page.getByLabel('Heading', { exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await heading.fill('[Autosaved visit]')
    await expect.poll(async () => (await read()).content[0].values.heading).toBe('[Autosaved visit]')
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await capture(page, folder, 'autosaved-visit')
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await expect(leave).toBeVisible()
    await expect(leave).toContainText('saved as a private draft')
    await capture(page, folder, 'saved-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(heading).toHaveValue('[Autosaved visit]')
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard my edits', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + id + '/history')
    let current = await read()
    expect(current.content[0].values.heading).toBe('[Opening private draft]')
    expect(current.meta).toEqual(opening.meta)
    expect(current.published_version_id).toBe(opening.published_version_id)
    await page.goto('/pages/' + id + '?section=0')
    await heading.fill('[Keep this private visit]')
    await expect.poll(async () => (await read()).content[0].values.heading).toBe('[Keep this private visit]')
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await capture(page, folder, 'keep-draft')
    const count = (await read()).versions
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await leave.getByRole('button', { name: 'Keep draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + id + '/history')
    current = await read()
    expect(current.content[0].values.heading).toBe('[Keep this private visit]')
    expect(current.versions).toBe(count)
    expect(current.published_version_id).toBe(opening.published_version_id)
    await page.goto('/pages/' + id + '?section=0')
    await heading.fill('[My later visit]')
    await expect.poll(async () => (await read()).content[0].values.heading).toBe('[My later visit]')
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await capture(page, folder, 'before-conflict')
    current = await read()
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      id,
      current.revision,
      content('[Another saved draft]'),
      JSON.stringify({ description: '[Keep search description]', noindex: false }),
    ])
    await c.query('COMMIT')
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard my edits', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not be discarded')
    await capture(page, folder, 'discard-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(heading).toHaveValue('[My later visit]')
    expect((await read()).content[0].values.heading).toBe('[Another saved draft]')
    expect((await read()).published_version_id).toBe(opening.published_version_id)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    if (id) await db.query('UPDATE pages SET archived_at=now() WHERE id=$1', [id])
    c.release()
    await db.end()
  }
})
test('leaving a page removes untouched new cards and slides, keeps authored additions, and discards visit additions', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/page-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let id = ''
  try {
    const home = (
        await f.pool.query(
          "SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=''",
          [f.siteId],
        )
      ).rows[0]!.content,
      content = structuredClone([home[1], home[0]])
    content[1].label = 'Hero'
    const site = (await f.pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    id = (
      await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        'item-leave-' + randomUUID().slice(0, 8),
        '[Item leave]',
      ])
    ).rows[0]!.id
    await f.client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify(content),
      JSON.stringify({ description: '[Item leave description]' }),
    ])
    await f.client.query("SELECT app.publish_page($1,1,2,NULL,'[]')", [id])
    await f.client.query('COMMIT')
    const read = async () =>
        (
          await f.pool.query(
            'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [id],
          )
        ).rows[0]!,
      before = await read(),
      cards = repeatItemKeys(content[0].values.cards).length,
      slides = repeatItemKeys(content[1].values.slides).length
    await signIn(page, 'editor@example.test')
    await page.setViewportSize({ width: 1440, height: 900 })
    const inspector = page.getByRole('complementary', { name: 'Inspector' }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await page.goto('/pages/' + id + '?section=0')
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await expect.poll(async () => repeatItemKeys((await read()).content[0].values.cards).length).toBe(cards + 1)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await capture(page, folder, 'empty-card')
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + id + '/history')
    expect(repeatItemKeys((await read()).content[0].values.cards)).toHaveLength(cards)
    await page.goto('/pages/' + id + '?section=1')
    await inspector.getByRole('button', { name: 'Add slide', exact: true }).click()
    await inspector.getByRole('button', { name: 'Start empty', exact: true }).click()
    await expect.poll(async () => repeatItemKeys((await read()).content[1].values.slides).length).toBe(slides + 1)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await capture(page, folder, 'empty-slide')
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await leave.getByRole('button', { name: 'Keep draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + id + '/history')
    expect(repeatItemKeys((await read()).content[1].values.slides)).toHaveLength(slides)
    await page.goto('/pages/' + id + '?section=0')
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await inspector.getByLabel('Title', { exact: true }).fill('[Keep this card]')
    await expect.poll(async () => Object.values((await read()).content[0].values)).toContain('[Keep this card]')
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await capture(page, folder, 'authored-card')
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await leave.getByRole('button', { name: 'Keep draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + id + '/history')
    expect(repeatItemKeys((await read()).content[0].values.cards)).toHaveLength(cards + 1)
    expect(Object.values((await read()).content[0].values)).toContain('[Keep this card]')
    await page.goto('/pages/' + id + '?section=0')
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await inspector.getByLabel('Title', { exact: true }).fill('[Discard this visit card]')
    await expect
      .poll(async () => Object.values((await read()).content[0].values))
      .toContain('[Discard this visit card]')
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await capture(page, folder, 'discard-card-visit')
    await page.getByRole('link', { name: 'Page history', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard my edits', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + id + '/history')
    const after = await read()
    expect(repeatItemKeys(after.content[0].values.cards)).toHaveLength(cards + 1)
    expect(Object.values(after.content[0].values)).not.toContain('[Discard this visit card]')
    expect(Object.values(after.content[0].values)).toContain('[Keep this card]')
    expect(after.published_version_id).toBe(before.published_version_id)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    if (id) await f.pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [id])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
