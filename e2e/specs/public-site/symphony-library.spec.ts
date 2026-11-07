import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn, saveDraft, treeLabels } from '../helpers.ts'
test('Symphony library previews a section at the chosen spot, moves it, cancels without a write and adds exactly once', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    id = f.pages[0]!,
    folder = resolve('../.r8-progress/round3/symphony-library/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const head = async () =>
        (await f.pool.query('SELECT revision,draft_version_id,published_version_id FROM pages WHERE id=$1', [id]))
          .rows[0],
      before = await head()
    await signIn(page, 'root@example.test')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/pages/' + id + '?section=0')
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await expect
          .poll(() =>
            page.locator('.canvas-viewport').evaluate(node => {
              const frame = node.querySelector('iframe')
              return (
                !frame ||
                Math.abs(
                  frame.getBoundingClientRect().width -
                    Math.min(
                      node.clientWidth - Number.parseFloat(getComputedStyle(node).paddingInlineStart || '0'),
                      Number.parseFloat(getComputedStyle(frame).width),
                    ),
                ) < 2
              )
            }),
          )
          .toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.getByRole('button', { name: 'More section actions', exact: true }).click()
    await page.getByRole('button', { name: 'Add below', exact: true }).click()
    const library = page.getByRole('dialog', { name: 'Add a section', exact: true })
    await expect(library).toContainText('after “Welcome”')
    await library.getByLabel('Search sections', { exact: true }).fill('Theater Space')
    await expect(library.getByTestId('library-card-core-feature-slider')).toContainText('Hero slider')
    await expect(library).toContainText('In Symphony: Theater Space')
    await capture('old-name-search')
    await library.getByRole('button', { name: 'Change spot', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Choose section spot', exact: true })).toBeVisible()
    await capture('choose-spot')
    await page
      .locator('[aria-label="Page canvas actions"]')
      .getByRole('button', { name: 'Add section at start of page', exact: true })
      .click()
    await expect(library).toContainText('before “Welcome”')
    await library.getByRole('button', { name: 'Change spot', exact: true }).click()
    await page.getByRole('button', { name: 'At the end of the page', exact: true }).click()
    await library.getByLabel('Search sections', { exact: true }).fill('Text block')
    const card = library.getByTestId('library-card-core-text-block')
    await expect(card).toBeVisible()
    await capture('browse')
    await card.getByRole('button', { name: /^Add Text block / }).click()
    await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
    await expect(library.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    await expect(library.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
    expect(
      (await library.getByRole('button', { name: 'Add this section', exact: true }).boundingBox())!.y,
    ).toBeGreaterThan((await library.getByLabel('Search sections', { exact: true }).boundingBox())!.y)
    const canvas = page.frameLocator('iframe[title="Page canvas"]')
    await expect(canvas.locator('[data-cms-section]')).toHaveCount(2)
    await expect(canvas.locator('[data-cms-section="1"]')).toHaveClass(/core-text-block/)
    expect(await head()).toEqual(before)
    await capture('sample-preview')
    await library.getByRole('button', { name: 'Move up', exact: true }).click()
    await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
    await expect(canvas.locator('[data-cms-section="0"]')).toHaveClass(/core-text-block/)
    expect(await head()).toEqual(before)
    await library.getByRole('button', { name: 'Back to sections', exact: true }).click()
    await expect(library).toBeVisible()
    await library.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(library).toHaveCount(0)
    await expect(canvas.locator('[data-cms-section]')).toHaveCount(1)
    expect(await head()).toEqual(before)
    await page.getByRole('button', { name: 'More section actions', exact: true }).click()
    await page.getByRole('button', { name: 'Add above', exact: true }).click()
    await library.getByLabel('Search sections', { exact: true }).fill('Text block')
    await library
      .getByTestId('library-card-core-text-block')
      .getByRole('button', { name: /^Add Text block / })
      .click()
    await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
    await library.getByRole('button', { name: 'Add this section', exact: true }).click()
    await expect(library).toHaveCount(0)
    await expect(treeLabels(page)).toHaveCount(2)
    await saveDraft(page)
    const content = (
      await f.pool.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      )
    ).rows[0].content
    expect(content).toHaveLength(2)
    expect(content[0].label).toBe('Text block')
    expect(content[1].label).toBe('Welcome')
    expect((await head()).published_version_id).toBe(before.published_version_id)
    await capture('added')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
