import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
const title = 'Primary Health Care to Support the Growing Chikankata Community'
test('failed Story-list choices stay on Keep, discard only unsaved work, and finish every private save before leaving', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(),
    folder = resolve('../.r8-progress/round3/story-list-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let native = 0,
    failures = 2,
    release = () => {}
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  try {
    const target = (
        await f.pool.query(
          "SELECT e.id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND v.values->>'title'=$2",
          [f.collectionId, title],
        )
      ).rows[0]!.id,
      read = async () =>
        (
          await f.pool.query(
            'SELECT e.draft_version_id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
            [target],
          )
        ).rows[0]!,
      before = await read(),
      base = '/sites/' + f.siteId + '/stories'
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto(base + '?q=Chikankata')
    const row = page.getByRole('article', { name: title, exact: true }),
      normalError = page.getByRole('alertdialog', { name: "Story changes weren't saved", exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      family = row.getByRole('button', { name: 'Family Care', exact: true }),
      education = row.getByRole('button', { name: 'Education', exact: true })
    await page.route('**/sites/' + f.siteId + '/stories*', async route => {
      if (failures > 0 && route.request().method() === 'POST') {
        failures--
        await route.abort('failed')
      } else await route.continue()
    })
    await family.click()
    await expect(normalError).toBeVisible()
    await normalError.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('link', { name: 'Manage tags', exact: true }).click()
    await expect(leave).toBeVisible()
    await capture('choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(family).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('link', { name: 'Manage tags', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await expect(family).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('link', { name: 'Manage tags', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base + '/tags')
    expect(await read()).toEqual(before)
    await page.goto(base + '?q=Chikankata')
    failures = 2
    await family.click()
    await expect(normalError).toBeVisible()
    await normalError.getByRole('button', { name: 'Cancel', exact: true }).click()
    await education.click()
    await expect(education).toHaveAttribute('aria-pressed', 'true')
    failures = 2
    await page.getByRole('link', { name: 'Manage tags', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('queued choices')
    await expect(normalError).toHaveCount(0)
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(family).toHaveAttribute('aria-pressed', 'true')
    await expect(education).toHaveAttribute('aria-pressed', 'true')
    expect(await read()).toEqual(before)
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let waiting = false
    await page.route('**/sites/' + f.siteId + '/stories*', async route => {
      if (route.request().method() === 'POST' && !waiting) {
        waiting = true
        await gate
      }
      await route.fallback()
    })
    await page.getByRole('link', { name: 'Manage tags', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your draft')
    await expect(leave.getByRole('button', { name: 'Keep editing', exact: true })).toBeDisabled()
    await capture('saving-before-leaving')
    release()
    await expect(page).toHaveURL(base + '/tags')
    await expect(page.getByRole('heading', { name: 'Manage tags', exact: true })).toBeVisible()
    const saved = await read()
    expect(saved.published_version_id).toBe(before.published_version_id)
    expect(saved.values.tags.split(',')).toEqual(expect.arrayContaining(['family-care', 'education']))
    for (const key of ['title', 'summary', 'body', 'photo', 'story_url'])
      expect(saved.values[key]).toEqual(before.values[key])
    expect(native).toBe(0)
  } finally {
    release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
