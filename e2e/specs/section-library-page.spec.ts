import { expect, test } from '@playwright/test'
import { signIn } from './helpers.ts'

// The section library page (SPEC §6.5, reference 18): one line of filters that
// apply as they change and stay in the address, above three columns of cards.
test('filters the section library as choices change, keeps them in the address and clears them', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const library = `${page.url()}/sections`
  await page.goto(library)
  const cards = page.locator('.library-card')
  const total = await cards.count()
  expect(total).toBeGreaterThan(3)
  // Three columns and a single line of filters at the reference's 1280px width.
  expect(
    await page
      .locator('.library-grid')
      .first()
      .evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length),
  ).toBe(3)
  const filters = page.getByRole('form', { name: 'Filter sections' })
  expect((await filters.boundingBox())!.height).toBeLessThan(64)

  // Typing settles, then searches; focus stays in the field.
  const search = page.getByLabel('Find a section')
  await search.fill('call to action')
  await expect(cards).toHaveCount(2)
  await expect(cards.getByRole('heading', { name: 'Call to action', level: 3, exact: true })).toBeVisible()
  await expect(cards.getByRole('heading', { name: 'Registration call to action', level: 3, exact: true })).toBeVisible()
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('call to action')
  await expect(search).toBeFocused()

  // Preview choices travel with the filters and survive clearing them.
  await page.getByLabel('Preview appearance', { exact: true }).selectOption('draft')
  await expect.poll(() => new URL(page.url()).searchParams.get('site')).toBe('draft')
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click()
  await page.getByLabel('Source', { exact: true }).selectOption('global')
  await expect.poll(() => new URL(page.url()).searchParams.get('site')).toBe('draft')
  await expect.poll(() => new URL(page.url()).searchParams.get('source')).toBe('global')
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click()
  await expect(cards).toHaveCount(total)
  await expect.poll(() => [...new URL(page.url()).searchParams.entries()]).toEqual([['site', 'draft']])
  await expect(page.getByLabel('Preview appearance', { exact: true })).toHaveValue('draft')
  await expect(search).toHaveValue('')

  // A category choice applies at once and names only that category.
  const category = page.getByLabel('Category', { exact: true })
  const first = (await category.locator('option').nth(1).textContent())!.trim()
  await category.selectOption({ label: first })
  await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe(first)
  await expect(page.locator('.cat-head h2')).toHaveText([first])

  // A bookmarked address opens on the same filtered list.
  await page.goto(`${library}?q=call+to+action`)
  await expect(cards).toHaveCount(2)
  await expect(search).toHaveValue('call to action')
})
