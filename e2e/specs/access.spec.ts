// Authorization as a person actually meets it (SPEC §6.1, §4). The database
// tests prove these refusals at the row level; these prove the product does not
// offer the affordance in the first place, and that going around the UI still
// fails.
import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openSeededPage, signIn } from './helpers.ts'

test.describe('sign-in', () => {
  test('renders server-side with no signed-out flash (v1 D12)', async ({ page }) => {
    // No auth race to lose: the session is resolved before the first byte.
    const response = await page.goto('/sign-in')
    const html = await response!.text()
    expect(html).toContain('Sign in')
    await expect(page.getByLabel('Email address')).toBeVisible()
    const folder = resolve('../.r8-progress/admin-entry')
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, 'sign-in-' + width + '.png') })
    }
  })

  test('offers no password field anywhere', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('an authenticated identity with no product record sees no tenant data', async ({ page }) => {
    // A verified sign-in is not authorization: this address was never invited.
    await signIn(page, 'stranger@example.test')
    await expect(page.getByRole('heading', { name: 'You are not signed in' })).toBeVisible()
    await expect(page.getByText('Demo site')).toHaveCount(0)
  })

  test('signing out ends the session', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByLabel('Email address')).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'You are not signed in' })).toBeVisible()
  })
})

test.describe('application navigation', () => {
  test('the desktop rail works and the mobile drawer traps the application behind it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page, 'editor@example.test')

    const sidebar = page.locator('#cms-sidebar')
    const main = page.locator('.app-main')
    await expect(sidebar).not.toHaveAttribute('inert', '')
    await page.getByRole('button', { name: 'Collapse sidebar · ⌘\\' }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar · ⌘\\' })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(sidebar).toHaveAttribute('inert', '')
    const opener = page.getByRole('button', { name: 'Open navigation' })
    await opener.click()
    await expect(sidebar).not.toHaveAttribute('inert', '')
    await expect(main).toHaveAttribute('inert', '')

    // A drawer stops being modal when the viewport grows. Its old focus trap
    // must not strand keyboard users inside what is now the ordinary rail.
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(main).not.toHaveAttribute('inert', '')
    await sidebar.getByRole('button', { name: 'Sign out' }).focus()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('#cms-sidebar') !== null)).toBe(false)

    await page.setViewportSize({ width: 390, height: 844 })
    await opener.click()

    await page.keyboard.press('Escape')
    await expect(sidebar).toHaveAttribute('inert', '')
    await expect(main).not.toHaveAttribute('inert', '')
    await expect(opener).toBeFocused()
  })
})

test.describe('capability tiers', () => {
  test('an editor can publish', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()
  })

  test('a contributor is offered review instead of publication', async ({ page }) => {
    await signIn(page, 'contributor@example.test')
    await openSeededPage(page)
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Submit for review' })).toBeEnabled()
  })

  test('a contributor can still save a draft', async ({ page }) => {
    await signIn(page, 'contributor@example.test')
    await openSeededPage(page)
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('All changes saved. The live site is not affected.')).toBeVisible()
  })
})

test('contributors are not offered page creation', async ({ page }) => {
  await signIn(page, 'contributor@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add a page' })).toHaveCount(0)
})

test.describe('route protection', () => {
  test('a page URL is not reachable without a session', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
    const url = page.url()

    await page.goto('/')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByLabel('Email address')).toBeVisible()

    const response = await page.goto(url)
    expect(response!.status()).toBe(404)
  })

  test('the preview route is not reachable without a session', async ({ page }) => {
    const response = await page.request.get('/preview/00000000-0000-0000-0000-000000000000')
    expect(response.status()).toBe(404)
    expect(await response.text()).toBe('')
  })
})

test.describe('operational visibility', () => {
  test('the dashboard states the worker is not running rather than staying silent', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await page.getByText('Test tools (this computer only)', { exact: true }).click()
    // No worker runs during the e2e suite, and that is exactly the case the
    // Super-admin Test tools must report it — v1's scheduling queue was inert and only honest
    // labelling kept it from being a lie (SPEC §6.8, D7).
    // Named, rather than reported as a colour with the word "Error" on it: the
    // chip carries the app-wide vocabulary and the sentence beside it carries
    // the fact somebody has to act on.
    await expect(page.getByText('The worker is not running')).toBeVisible()
    await expect(page.getByText(/Scheduled publishing and cache updates are paused/)).toBeVisible()
  })

  test('shows queue figures so a stalled queue is visible in the app', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await page.getByText('Test tools (this computer only)', { exact: true }).click()
    await expect(page.getByText('Waiting to send')).toBeVisible()
    await expect(page.getByText('Gave up')).toBeVisible()
    await expect(page.getByText('Oldest waiting')).toBeVisible()
  })

  test('keeps operator telemetry out of an editor’s publishing dashboard', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(page.getByText('Background jobs')).toHaveCount(0)
    await expect(page.getByText('Waiting to send')).toHaveCount(0)
  })
})
