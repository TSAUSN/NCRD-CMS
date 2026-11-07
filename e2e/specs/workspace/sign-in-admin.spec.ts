import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test('sign-in separates the local receipt and expired link from entry and keeps pending requests single', async ({
  page,
}, info) => {
  const folder = resolve('../.r8-progress/round3/sign-in-admin/' + info.project.name)
  let release = () => {}
  try {
    await mkdir(folder, { recursive: true })
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(() => document.fonts.ready)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible()
    await capture('entry')
    await page.locator('summary').filter({ hasText: 'About local sign-in' }).click()
    await expect(page.getByText('Sample staff accounts sign in straight away.', { exact: false })).toBeVisible()
    await capture('local-explanation')
    await page.goto('/sign-in?sent=1')
    await expect(page.getByRole('heading', { name: 'Check the local outbox', exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('No email was sent')
    await expect(page.getByLabel('Email address', { exact: true })).toHaveCount(0)
    await capture('receipt')
    await page.getByRole('link', { name: 'Use a different email', exact: true }).click()
    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible()
    await page.goto('/sign-in?error=expired-link')
    await expect(page.getByRole('heading', { name: 'That link has expired', exact: true })).toBeVisible()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('expired or has already been used')
    await capture('expired')
    await page.getByRole('link', { name: 'Request a new link', exact: true }).click()
    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible()
    await page.goto('/sign-in?error=unavailable')
    await expect(page.getByRole('main').getByRole('alert')).toContainText('temporarily unavailable')
    await capture('error')
    await page.goto('/sign-in')
    await page.getByLabel('Email address', { exact: true }).fill('root@example.test')
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    await page.route('**/sign-in', async route => {
      if (route.request().method() === 'POST') {
        await held
        await route.continue()
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Continue to local CMS', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Please wait…', exact: true })).toBeDisabled()
    await capture('pending')
    release()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Home', level: 1, exact: true })).toBeVisible()
  } finally {
    release()
  }
})
