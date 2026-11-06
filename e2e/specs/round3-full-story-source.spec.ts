import { E2E_PORTS } from '../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
import { corePageDefinitions } from '../../apps/admin/src/lib/core-pages.ts'
import { sawsoSection } from '../../apps/admin/src/lib/sawso-pages.ts'
async function publish(page: Page, siteId: string) {
  await page.goto('/sites/' + siteId + '/publishing?lists=1')
  const button = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
  await button.click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
    timeout: 90000,
  })
  const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
  if (await sample.isVisible()) await sample.check()
  const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings', exact: true })
  if (await reason.isVisible()) await reason.fill('Reviewing the isolated sample Story count fixture.')
  await button.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 90000 })
}
test('full World and Split sources include story201 in public and private views without JavaScript', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(),
    folder = resolve('../.r8-progress/round3/story-source-window/' + info.project.name),
    last = '[Source story 0200]'
  await mkdir(folder, { recursive: true })
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const head = (await f.client.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collectionId])).rows[0]!
    // Count/rendering fixture only: cards point to the existing Home. Article
    // ownership and individual URLs have their own creation/publication journeys.
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: null,
      stableKey: 'source-' + String(i).padStart(4, '0'),
      values: {
        title: '[Source story ' + String(i).padStart(4, '0') + ']',
        summary: '[Description]',
        published_date: new Date().toISOString().slice(0, 10),
        tags: 'health',
        regions: 'africa',
        region: 'africa',
        region_label: 'Africa',
        sector_links: 'Health',
        story_url: '/',
        body: '<p>[Full source article]</p>',
        body_is_sample: true,
        photo: { src: '/cms-samples/r8-landscape.png', alt: '[Source photo]', decorative: false },
        photo_is_sample: true,
      },
    }))
    await f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collectionId,
      head.entry_revision,
      JSON.stringify(rows),
    ])
    const defs = await corePageDefinitions(f.client),
      binding = {
        readerKey: 'stories',
        selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 200 },
      }
    for (const kind of ['story-world', 'story-split']) {
      const slug = kind === 'story-world' ? 'world-stories' : 'newsroom',
        id = (await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [f.siteId, slug, '[' + kind + ']']))
          .rows[0]!.id,
        section = sawsoSection(defs, kind, 'Stories', {
          heading: kind === 'story-world' ? '[Where we work]' : '[News and stories]',
          stories: binding,
          start_region: 'africa',
          per_region: '200',
          start_view: 'recent',
          page_size: '6',
        }),
        sections =
          kind === 'story-world'
            ? [sawsoSection(defs, 'page-header', 'Page header', { heading: '[World stories]', intro: '' }), section]
            : [section]
      await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, JSON.stringify(sections), '{}'])
    }
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/preview/stories/' + f.siteId + '?widget=world&region=africa')
    await expect(page.getByRole('heading', { name: last, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^\[Source story \d{4}\]$/ })).toHaveCount(201)
    await page.goto('/preview/stories/' + f.siteId + '?widget=split&story0_page=34')
    await expect(page.getByRole('heading', { name: last, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^\[Source story \d{4}\]$/ })).toHaveCount(201)
    await publish(page, f.siteId)
    const context = await browser.newContext({ javaScriptEnabled: false }),
      view = await context.newPage()
    try {
      const origin = 'http://' + f.hostname + `:${E2E_PORTS.site}`
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 900 })
        await view.goto(origin + '/world-stories')
        await expect(view.getByRole('heading', { name: last, exact: true })).toBeVisible()
        await expect(view.getByRole('heading', { name: /^\[Source story \d{4}\]$/ })).toHaveCount(201)
        await expect(view.getByRole('link', { name: 'Africa (201)', exact: true })).toBeVisible()
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'world201-' + width + '.png') })
        await view.getByRole('heading', { name: last, exact: true }).scrollIntoViewIfNeeded()
        await view.screenshot({ path: resolve(folder, 'world201-last-' + width + '.png') })
        await view.goto(origin + '/newsroom')
        await expect(view.getByRole('heading', { name: /^\[Source story \d{4}\]$/ })).toHaveCount(6)
        await expect(view.getByText('Showing 6 of 201 stories', { exact: true })).toBeVisible()
        await view.goto(origin + '/newsroom?story0_view=recent&story0_page=34')
        await expect(view.getByRole('heading', { name: last, exact: true })).toBeVisible()
        await expect(view.getByRole('heading', { name: /^\[Source story \d{4}\]$/ })).toHaveCount(201)
        await expect(view.getByText('Showing 201 of 201 stories', { exact: true })).toBeVisible()
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'split201-' + width + '.png') })
        await view.getByRole('heading', { name: last, exact: true }).scrollIntoViewIfNeeded()
        await view.screenshot({ path: resolve(folder, 'split201-last-' + width + '.png') })
      }
      await view.goto(origin + '/newsroom?story0_view=sectors')
      await expect(view.getByRole('link', { name: 'Health 201 stories', exact: true })).toBeVisible()
      await view.getByRole('link', { name: 'Health 201 stories', exact: true }).click()
      await expect(view.getByRole('heading', { name: last, exact: true })).toBeVisible()
    } finally {
      await context.close()
    }
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
