import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
test('Story grids keep every selected card and center balanced rows without JavaScript', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-grid/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let visitor: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const saved = (
        await f.client.query(
          "SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='ways-we-help/education'",
          [f.siteId],
        )
      ).rows[0]!,
      defs = (
        await f.client.query("SELECT id FROM section_defs WHERE slug='core-stories' AND scope='global'")
      ).rows.map(row => row.id),
      story = saved.content.find((item: { section_def_id: string }) => defs.includes(item.section_def_id))
    expect(story).toBeTruthy()
    const content = Array.from({ length: 12 }, (_, i) => ({
      ...story,
      label: 'Stories ' + (i + 1),
      values: {
        ...story.values,
        __cms_anchor: 'stories-' + (i + 1),
        heading: 'Stories ' + (i + 1),
        stories: {
          readerKey: 'stories',
          selection: {
            mode: 'automatic',
            order: 'newest',
            limit: i + 1,
            dateField: 'published_date',
            maxAgeMonths: 13,
          },
        },
      },
    }))
    await f.client.query("SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint',$5)", [
      saved.id,
      saved.revision,
      JSON.stringify(content),
      JSON.stringify(saved.meta),
      'Review shared Story grids',
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/publishing?siteLook=1&lists=1&pages=' + saved.id)
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    await expect(sample.or(page.getByRole('alertdialog'))).toBeVisible({ timeout: 60000 })
    if (await sample.isVisible()) {
      await sample.check()
      const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible()) await reason.fill('Reviewing isolated responsive Story grid examples.')
      await publish.click()
    }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    visitor = await browser.newContext({ javaScriptEnabled: false })
    const view = await visitor.newPage()
    await view.goto('http://' + f.hostname + `:${E2E_PORTS.site}/ways-we-help/education`)
    await expect(view.locator('[data-cms-story-grid]')).toHaveCount(12)
    for (const width of [1440, 1024, 390]) {
      await view.setViewportSize({ width, height: 900 })
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (let count = 1; count <= 12; count++) {
        const grid = view.locator('[data-cms-story-grid]').nth(count - 1)
        await expect(grid.locator('.core-story-card')).toHaveCount(count)
        const geometry = await grid.evaluate(node => {
          const box = node.getBoundingClientRect(),
            style = getComputedStyle(node),
            left = box.left + parseFloat(style.paddingLeft),
            right = box.right - parseFloat(style.paddingRight)
          return {
            left,
            right,
            cards: Array.from(node.querySelectorAll('.core-story-card')).map(card => {
              const b = card.getBoundingClientRect()
              return {
                left: b.left,
                right: b.right,
                top: Math.round(b.top),
                width: b.width,
                display: getComputedStyle(card).display,
              }
            }),
          }
        })
        expect(geometry.cards.every(card => card.width > 0 && card.display !== 'none')).toBe(true)
        const rows: Record<number, typeof geometry.cards> = {}
        for (const card of geometry.cards) (rows[card.top] ??= []).push(card)
        for (const row of Object.values(rows)) {
          expect(
            Math.abs((row![0]!.left + row!.at(-1)!.right) / 2 - (geometry.left + geometry.right) / 2),
          ).toBeLessThan(2)
        }
        if (width === 390) expect(Object.keys(rows)).toHaveLength(count)
        if (count === 1 && width > 767)
          expect(geometry.cards[0]!.width / (geometry.right - geometry.left)).toBeCloseTo(0.49, 1)
        if (width === 1440 && count === 8) expect(Object.keys(rows)).toHaveLength(2)
        if (width === 1440 && count === 6) expect(Object.keys(rows)).toHaveLength(2)
        if ([1, 3, 5, 8].includes(count))
          await grid.screenshot({ path: resolve(folder, 'cards-' + count + '-' + width + '.png') })
      }
    }
  } finally {
    await visitor?.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
