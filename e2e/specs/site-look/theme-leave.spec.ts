import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'
test('site-look leave validates and keeps choices, discards locally, and waits for its private save before opening Fonts', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/theme-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let release = () => {},
    native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  const read = async () =>
      (
        await f.pool.query(
          'SELECT h.draft_version_id,h.published_version_id,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
          [f.site],
        )
      ).rows[0]!,
    capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
  try {
    const before = await read(),
      base = '/sites/' + f.site + '/design',
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      brand = page.getByLabel('Brand', { exact: true })
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await brand.fill('#175777')
    await page
      .getByRole('navigation', { name: 'In this area', exact: true })
      .getByRole('link', { name: 'Fonts', exact: true })
      .click()
    await expect(leave).toBeVisible()
    await capture('choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(brand).toHaveValue('#175777')
    await page
      .getByRole('navigation', { name: 'In this area', exact: true })
      .getByRole('link', { name: 'Fonts', exact: true })
      .click()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await brand.fill('#12')
    await page
      .getByRole('navigation', { name: 'In this area', exact: true })
      .getByRole('link', { name: 'Fonts', exact: true })
      .click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Check the colour and font choices')
    await capture('invalid-refused')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base + '/fonts')
    expect(await read()).toEqual(before)
    await page.goto(base)
    await brand.fill('#175777')
    let fail = true
    await page.route('**/sites/' + f.site + '/design', async route => {
      if (fail && route.request().method() === 'POST') {
        fail = false
        await route.abort('failed')
      } else await route.continue()
    })
    await page
      .getByRole('navigation', { name: 'In this area', exact: true })
      .getByRole('link', { name: 'Fonts', exact: true })
      .click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('design draft could not be saved')
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(brand).toHaveValue('#175777')
    expect(await read()).toEqual(before)
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let waiting = false
    await page.route('**/sites/' + f.site + '/design', async route => {
      if (!waiting && route.request().method() === 'POST') {
        waiting = true
        await gate
      }
      await route.fallback()
    })
    await page
      .getByRole('navigation', { name: 'In this area', exact: true })
      .getByRole('link', { name: 'Fonts', exact: true })
      .click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your draft')
    await capture('saving-before-leaving')
    release()
    await expect(page).toHaveURL(base + '/fonts')
    const saved = await read()
    expect(saved.draft_version_id).not.toBe(before.draft_version_id)
    expect(saved.published_version_id).toBe(before.published_version_id)
    expect(saved.tokens).toEqual({ ...before.tokens, colors: { ...before.tokens.colors, primary: '#175777' } })
    expect(native).toBe(0)
  } finally {
    release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
