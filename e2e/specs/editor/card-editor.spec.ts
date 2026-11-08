import { test, expect, type FrameLocator, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, saveDraft } from '../helpers.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/round3/card-editor', engine)
  await mkdir(folder, { recursive: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(folder, name + '.png') })
}
async function shape(frame: FrameLocator) {
  return frame.locator('body').evaluate(body =>
    [...body.querySelectorAll<HTMLElement>('[data-cms-section]')].map(section => ({
      section: section.dataset.cmsSection,
      grids: [
        ...section.querySelectorAll<HTMLElement>(
          '.national-tiles,.national-photo-grid,.national-contacts,.national-steps,[data-cms-reader]',
        ),
      ].map(grid => {
        const base = grid.getBoundingClientRect(),
          style = getComputedStyle(grid),
          round = (value: number) => Math.round(value * 10) / 10
        return {
          columns: style.gridTemplateColumns,
          width: round(base.width),
          height: round(base.height),
          children: [...grid.children].map(child => {
            const rect = child.getBoundingClientRect()
            return {
              tag: child.tagName,
              x: round(rect.left - base.left),
              y: round(rect.top - base.top),
              width: round(rect.width),
              height: round(rect.height),
            }
          }),
        }
      }),
    })),
  )
}
async function tilePresentation(frame: FrameLocator) {
  return frame
    .locator('.national-tiles')
    .first()
    .evaluate(grid => {
      const base = grid.getBoundingClientRect(),
        round = (n: number) => Math.round(n * 10) / 10
      return {
        columns: getComputedStyle(grid).gridTemplateColumns,
        cards: [...grid.children].slice(0, 5).map(card => {
          const box = card.getBoundingClientRect(),
            style = getComputedStyle(card),
            icon = card.querySelector('.national-icon')
          return {
            x: round(box.left - base.left),
            y: round(box.top - base.top),
            width: round(box.width),
            height: round(box.height),
            background: style.backgroundColor,
            align: style.textAlign,
            iconWidth: icon ? round(icon.getBoundingClientRect().width) : 0,
          }
        }),
      }
    })
}
test('selecting any native card section preserves the real page geometry and keeps controls outside content', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  try {
    const home = (
        await f.pool.query(
          "SELECT p.id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=''",
          [f.siteId],
        )
      ).rows[0]!,
      indices = home.content.flatMap((section: { values: Record<string, unknown> }, index: number) =>
        Object.values(section.values).some(
          value => value && typeof value === 'object' && ('items' in value || 'readerKey' in value),
        )
          ? [index]
          : [],
      )
    expect(indices).toContain(1)
    expect(indices.length).toBeGreaterThan(3)
    await signIn(page, 'root@example.test')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/pages/' + home.id)
      const frame = page.frameLocator('iframe[title="Page canvas"]')
      await expect(frame.locator('[data-cms-section="1"]')).toBeVisible()
      await frame.locator('body').evaluate(async body => {
        await body.ownerDocument.fonts.ready
      })
      const before = await shape(frame)
      await frame.getByRole('heading', { name: 'What We Do', exact: true }).scrollIntoViewIfNeeded()
      await capture(page, 'before-select-' + width, info.project.name)
      for (const index of indices) {
        const root = frame.locator('[data-cms-section="' + index + '"]')
        await root.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
        await expect(root).toBeInViewport({ ratio: 0.25 })
        const sectionPoint = await root.evaluate((node, needsSectionInspector) => {
          const box = node.getBoundingClientRect()
          const blocked = needsSectionInspector
            ? '[data-cms-slot], [data-cms-entry], [data-cms-frame], .cms-hero-controls'
            : '[data-cms-entry], [data-cms-frame], .cms-hero-controls'
          for (const y of [0.08, 0.2, 0.5, 0.8, 0.92]) {
            for (const x of [0.03, 0.1, 0.9, 0.97, 0.5]) {
              const position = { x: Math.round(box.width * x), y: Math.round(box.height * y) }
              const safe = [
                [0, 0],
                [-3, -3],
                [3, 3],
              ].every(([dx, dy]) => {
                const hit = node.ownerDocument.elementFromPoint(box.left + position.x + dx!, box.top + position.y + dy!)
                return hit?.closest('[data-cms-section]') === node && !hit.closest(blocked)
              })
              if (safe) return { position, width: box.width, height: box.height }
            }
          }
          throw new Error('No visible point to select within this section')
        }, index === 1)
        const renderedBox = await root.boundingBox()
        expect(renderedBox).not.toBeNull()
        await root.click({
          position: {
            x: sectionPoint.position.x * (renderedBox!.width / sectionPoint.width),
            y: sectionPoint.position.y * (renderedBox!.height / sectionPoint.height),
          },
        })
        await expect
          .poll(() =>
            root.evaluate(
              node => node.hasAttribute('data-cms-selected') || node.hasAttribute('data-cms-selected-within'),
            ),
          )
          .toBe(true)
        await expect.poll(() => shape(frame)).toEqual(before)
        await expect(frame.locator('[data-cms-editor-ghost],[data-cms-editor-list-ghost]')).toHaveCount(0)
        await expect(frame.getByRole('button', { name: /^Add (?:a )?(?:card|slide|section)/i })).toHaveCount(0)
        const toolbar = page.getByRole('toolbar', { name: 'Selected section actions', exact: true })
        await expect(toolbar).toBeVisible()
        const box = await toolbar.boundingBox(),
          canvas = await page.locator('iframe[title="Page canvas"]').boundingBox()
        expect(box!.y + box!.height).toBeLessThanOrEqual(canvas!.y + 1)
        if (index === 1) {
          await expect(
            page
              .getByRole('complementary', { name: 'Inspector' })
              .getByRole('button', { name: 'Add a card', exact: true }),
          ).toBeVisible()
          await capture(page, 'after-select-' + width, info.project.name)
        }
      }
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
test('native card additions are empty, preview as typed, cancel completely and keep exactly one authored card', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  try {
    const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!.id
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + home + '?section=1')
    const inspector = page.getByRole('complementary', { name: 'Inspector' }),
      frame = page.frameLocator('iframe[title="Page canvas"]'),
      cards = frame.locator('.national-tiles').first().locator(':scope > article')
    await expect(cards).toHaveCount(5)
    await frame.locator('body').evaluate(async body => {
      await body.ownerDocument.fonts.ready
    })
    const presentation = await tilePresentation(frame)
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await expect(cards).toHaveCount(6)
    await expect
      .poll(() =>
        cards.evaluateAll(nodes => {
          const tops = nodes.map(n => Math.round(n.getBoundingClientRect().top))
          const rows = [...new Set(tops)]
          return tops.map(y => rows.indexOf(y))
        }),
      )
      .toEqual([0, 0, 0, 1, 1, 1])
    await expect(inspector.getByRole('heading', { name: 'New card', exact: true })).toBeVisible()
    await expect(inspector.getByLabel('Title', { exact: true })).toHaveValue('')
    await expect(inspector.getByRole('button', { name: 'Done', exact: true })).toBeDisabled()
    await inspector.getByLabel('Title', { exact: true }).fill('[Cancelled protection]')
    await expect(frame.getByText('[Cancelled protection]', { exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await capture(page, 'new-card-' + width, info.project.name)
    }
    await inspector.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(cards).toHaveCount(5)
    await expect(frame.getByText('[Cancelled protection]', { exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect.poll(() => tilePresentation(frame)).toEqual(presentation)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await expect(cards).toHaveCount(6)
    await expect(page.locator('.canvas-loading')).toHaveCount(0)
    await page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: /^About us$/i })
      .click()
    await expect(inspector.getByRole('heading', { name: /^About us$/i })).toBeVisible()
    await expect(cards).toHaveCount(5)
    await frame.getByRole('heading', { name: 'What We Do', exact: true }).click()
    await inspector.getByRole('button', { name: 'Back', exact: true }).click()
    await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
    await inspector.getByLabel('Title', { exact: true }).fill('[Protection]')
    await inspector.getByRole('button', { name: 'Choose icon', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose an icon', exact: true })
    await picker.getByRole('searchbox', { name: 'Search icons', exact: true }).fill('shield')
    await picker.getByRole('button', { name: 'Protection', exact: true }).click()
    await expect(frame.getByText('[Protection]', { exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(cards).toHaveCount(6)
    const sixPresentation = await tilePresentation(frame)
    expect(sixPresentation.cards.map(({ background, align, iconWidth }) => ({ background, align, iconWidth }))).toEqual(
      presentation.cards.map(({ background, align, iconWidth }) => ({ background, align, iconWidth })),
    )
    await expect
      .poll(() =>
        cards.evaluateAll(nodes => {
          const tops = nodes.map(n => Math.round(n.getBoundingClientRect().top))
          const rows = [...new Set(tops)]
          return tops.map(y => rows.indexOf(y))
        }),
      )
      .toEqual([0, 0, 0, 1, 1, 1])
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await capture(page, 'kept-card-' + width, info.project.name)
    }
    await saveDraft(page)
    const values = (
      await f.pool.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [home],
      )
    ).rows[0]!.content[1].values
    expect(values.cards.items).toEqual(['i1', 'i2', 'i3', 'i4', 'i5', 'i6'])
    expect(values.cards__i6__title).toBe('[Protection]')
    expect(values.cards__i6__icon).toBe('shield')
    expect(values.cards__i7__title).toBeUndefined()
    expect(values.__cms_tile_layout).toBe('five')
    expect(values.__cms_sample_fields ?? []).not.toContain('cards__i6__icon')
    expect(JSON.stringify(values)).not.toContain('[Cancelled protection]')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.reload()
    await expect(cards).toHaveCount(6)
    await expect.poll(() => tilePresentation(frame)).toEqual(sixPresentation)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
