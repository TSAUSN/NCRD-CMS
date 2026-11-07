import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
test('native editor keeps its collapsed page list, opens one section, jumps without scrolling its toolbar and remembers bounded panel width', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/editor-navigation', info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!.id
    await signIn(page, 'root@example.test')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/pages/' + home)
      const tree = page.getByRole('complementary', { name: 'Page structure' }),
        frame = page.frameLocator('iframe[title="Page canvas"]')
      if (width === 1024) {
        await expect(tree).toBeHidden()
        await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
      }
      await expect(tree).toBeVisible()
      await expect(frame.getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
      await expect(tree.locator('.tree-collapse[aria-expanded=true]')).toHaveCount(0)
      await page.screenshot({ path: resolve(folder, 'collapsed-' + width + '.png') })
      await tree.getByRole('button', { name: 'What We Do', exact: true }).click()
      if (width === 1024 && !(await tree.isVisible()))
        await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
      await expect(tree.locator('.tree-collapse[aria-expanded=true]')).toHaveCount(1)
      await expect(tree.getByRole('button', { name: /^Card [1-5]:/ })).toHaveCount(5)
      await expect(tree.getByRole('button', { name: /Card 1 ·/ })).toHaveCount(0)
      const introduction = page
        .getByRole('complementary', { name: 'Inspector' })
        .locator('[data-inspector-slot="intro"] .tiptap')
      await expect(introduction).toBeHidden()
      await tree.getByRole('button', { name: 'Introduction', exact: true }).click()
      await expect(introduction).toBeVisible()
      await page.screenshot({ path: resolve(folder, 'selected-' + width + '.png') })
      if (width === 1024 && !(await tree.isVisible()))
        await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
      await tree.getByRole('button', { name: /^About us$/i }).click()
      if (width === 1024 && !(await tree.isVisible()))
        await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
      await expect(tree.getByRole('button', { name: 'Expand What We Do', exact: true })).toBeVisible()
      await expect(tree.locator('.tree-collapse[aria-expanded=true]')).toHaveCount(1)
      await tree.getByRole('button', { name: 'News and Stories', exact: true }).click()
      const toolbar = page.getByRole('toolbar', { name: 'Selected section actions', exact: true })
      await expect(toolbar).toBeVisible()
      await expect
        .poll(() => frame.locator('body').evaluate(body => body.ownerDocument.defaultView!.scrollY))
        .toBeGreaterThan(0)
      await expect
        .poll(() =>
          page.evaluate(() => ({
            top: document.querySelector('.editor')!.getBoundingClientRect().top,
            scroll: window.scrollY,
            canvasScroll: document.querySelector('.canvas-pane')!.scrollTop,
          })),
        )
        .toEqual({ top: 0, scroll: 0, canvasScroll: 0 })
      const tools = await toolbar.boundingBox(),
        canvas = await page.locator('iframe[title="Page canvas"]').boundingBox()
      expect(tools!.y).toBeGreaterThanOrEqual(0)
      expect(tools!.y + tools!.height).toBeLessThanOrEqual(canvas!.y + 1)
      await page.screenshot({ path: resolve(folder, 'jump-' + width + '.png') })
      const resize = page.getByRole('separator', { name: 'Resize inspector', exact: true }),
        before = Number(await resize.getAttribute('aria-valuenow'))
      await resize.press('ArrowLeft')
      await expect(resize).toHaveAttribute('aria-valuenow', String(before + 16))
      await page.reload()
      if (width === 1024) await expect(tree).toBeHidden()
      else await expect(tree).toBeVisible()
      await expect(resize).toHaveAttribute('aria-valuenow', String(before + 16))
      await expect(frame.getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
      await expect(page.locator('.canvas-loading')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'width-restored-' + width + '.png') })
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
