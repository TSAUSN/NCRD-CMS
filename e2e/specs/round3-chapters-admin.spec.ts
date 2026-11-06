import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn } from './helpers.ts'

test('native Chapters keeps saved chapter details beside the list and shows public destinations without changing a draft', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(true),
    folder = resolve('../.r8-progress/round3/chapters-admin/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const before = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      chapters = (await f.pool.query('SELECT * FROM chapters WHERE site_id=$1 ORDER BY id', [f.site])).rows
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/chapters')
    await expect(page.getByRole('heading', { name: 'Chapters', level: 1, exact: true })).toBeVisible()
    const table = page.getByRole('table', { name: 'Chapters', exact: true }),
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.evaluate(() => document.fonts.ready)
          await page
            .getByRole('heading', { name: 'Chapters', level: 1, exact: true })
            .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
        }
      }
    const tools = page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: 'Test tools (this computer only)' }) })
    await expect(tools).toHaveCount(1)
    await expect(tools).not.toHaveAttribute('open', '')
    await expect(page.getByRole('link', { name: 'Local outbox', exact: true })).toBeHidden()
    await tools.locator('summary').click()
    await expect(page.getByRole('link', { name: 'Local outbox', exact: true })).toBeVisible()
    await tools.locator('summary').click()
    for (const row of await table.locator('tbody tr').all()) await expect(row.getByRole('button')).toHaveCount(1)
    await expect(page.getByRole('dialog').first()).toHaveAttribute('aria-modal', 'false')
    await expect(page.getByText('No chapter editors are assigned.', { exact: true })).toBeVisible()
    await capture('default')
    await page.getByRole('searchbox', { name: 'Find a chapter', exact: true }).fill('Peoria')
    await table.getByRole('button', { name: 'Peoria Chapter', exact: true }).click()
    let detail = page.getByRole('dialog', { name: 'Peoria Chapter', exact: true })
    await expect(detail.getByText('No chapter editors are assigned.', { exact: true })).toBeVisible()
    await expect(detail).toContainText('Not published yet')
    await capture('chapter')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      const left = await table.boundingBox(),
        right = await detail.boundingBox()
      expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width)
      await expect
        .poll(async () => {
          const box = await detail.getByRole('button', { name: 'Set up', exact: true }).boundingBox()
          return box!.y + box!.height <= 1000
        })
        .toBe(true)
    }
    await detail.getByRole('button', { name: 'Set up', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Set up Peoria Chapter', exact: true })
    await expect(form).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Peoria Chapter', exact: true })).toHaveCount(0)
    await capture('setup')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(form).toBeHidden()
    await detail.getByRole('button', { name: 'Invite a volunteer', exact: true }).click()
    const invitation = page.getByRole('dialog', { name: 'Invite an editor for Peoria Chapter', exact: true })
    await expect(invitation).toBeVisible()
    await capture('invite')
    await invitation.getByRole('textbox', { name: /^Volunteer name/ }).fill('Chapter editor (sample)')
    await invitation.getByRole('textbox', { name: /^Volunteer email/ }).fill('chapter-detail@example.test')
    await invitation.getByRole('button', { name: 'Invite chapter editor', exact: true }).click()
    await expect(invitation).toBeHidden()
    await expect(detail.getByText('Chapter editor (sample)', { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const box = await detail.getByRole('button', { name: 'Set up', exact: true }).boundingBox()
        return box!.y + box!.height <= 1000
      })
      .toBe(true)
    await capture('editor-access')
    await page.getByRole('searchbox', { name: 'Find a chapter', exact: true }).fill('')
    await table.getByRole('button', { name: 'Detroit Chapter', exact: true }).click()
    detail = page.getByRole('dialog', { name: 'Detroit Chapter', exact: true })
    await expect(detail).toContainText('Address not checked')
    await expect(detail.getByRole('link', { name: 'Open saved address', exact: true })).toHaveAttribute(
      'href',
      'https://example.test/chapters/detroit',
    )
    await expect(detail.getByRole('link', { name: 'Open saved address', exact: true })).toHaveAttribute(
      'target',
      '_blank',
    )
    await capture('linked')
    let fail = true
    await page.route('**/sites/' + f.site + '/chapters', async route => {
      if (fail && route.request().method() === 'POST') {
        fail = false
        await route.fulfill({ status: 503, body: 'Unavailable' })
      } else await route.continue()
    })
    await table.getByRole('button', { name: 'Peoria Chapter', exact: true }).click()
    detail = page.getByRole('dialog', { name: 'Peoria Chapter', exact: true })
    await expect(detail.getByRole('alert')).toContainText('could not be loaded')
    await capture('load-error')
    await detail.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(detail.getByText('Chapter editor (sample)', { exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Find a chapter', exact: true }).fill('no-chapter-matches-this')
    await expect(page.getByText('No chapters match.', { exact: false })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await capture('empty')
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(before)
    expect((await f.pool.query('SELECT * FROM chapters WHERE site_id=$1 ORDER BY id', [f.site])).rows).toEqual(chapters)
  } finally {
    f.client.release()
    await f.pool.end()
  }
})
