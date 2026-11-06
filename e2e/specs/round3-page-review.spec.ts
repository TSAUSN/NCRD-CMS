import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { repeatItemSpec, repeatItemKeys, repeatItemSlotId } from '@cms/schema'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('saved page review and Ready use the same real card, paragraph and slide-focus words with Show and Cancel', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/page-review/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let pageId = ''
  try {
    const home = (
        await f.pool.query(
          "SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=''",
          [f.siteId],
        )
      ).rows[0]!,
      content = structuredClone([home.content[1], home.content[0], home.content[2]])
    content[1].label = 'Hero'
    content[2].label = 'About Us'
    const siteId = (await f.pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    pageId = (
      await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [
        siteId,
        'review-' + randomUUID().slice(0, 8),
        '[Review page]',
      ])
    ).rows[0]!.id
    await f.client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify(content),
      JSON.stringify({ description: '[Review page description]' }),
    ])
    await f.client.query("SELECT app.publish_page($1,1,2,NULL,'[]')", [pageId])
    const live = (await f.client.query('SELECT published_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
      .published_version_id
    const hero = content[1],
      slots = (
        await f.client.query('SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2', [
          hero.section_def_id,
          hero.section_def_version,
        ])
      ).rows[0]!.slots,
      repeat = slots.find(
        (slot: { id: string; kind: string; label: string }) => repeatItemSpec(slot)?.unit.toLowerCase() === 'slide',
      )!,
      spec = repeatItemSpec(repeat)!,
      photo = spec.fields.find(field => field.kind === 'image')!,
      key = repeatItemKeys(hero.values[repeat.id])[1]!,
      id = repeatItemSlotId(repeat.id, key, photo.id)
    hero.values[id] = { ...hero.values[id], focal: { x: 0.2, y: 0.8 } }
    content[2].values.body = String(content[2].values.body).replace(
      /<p\b[^>]*>[\s\S]*?<\/p>/i,
      '<p>[Edited paragraph]</p>',
    )
    await f.client.query('SELECT app.save_page_draft($1,2,$2,$3)', [
      pageId,
      JSON.stringify(content),
      JSON.stringify({ description: '[Review page description]' }),
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + pageId + '?section=0')
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await inspector.getByLabel('Title', { exact: true }).fill('Protection')
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Publish this page', exact: true })
    await expect(review).toBeVisible()
    const words = [
      'What We Do: added a card, "Protection"',
      'Hero: changed the focus point on slide 2',
      'About Us: edited 1 paragraph',
    ]
    for (const word of words) await expect(review).toContainText(word)
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await capture('saved-review')
    await review
      .getByRole('listitem')
      .filter({ hasText: words[0] })
      .getByRole('button', { name: 'Show', exact: true })
      .click()
    await expect(review).toHaveCount(0)
    await expect(inspector.getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(review).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(review).toHaveCount(0)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await review.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto('/sites/' + siteId + '/publishing')
    for (const word of words)
      await expect(page.getByText(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).first()).toBeVisible()
    await capture('ready-list')
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
        .published_version_id,
    ).toBe(live)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    if (pageId) await f.pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [pageId])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
