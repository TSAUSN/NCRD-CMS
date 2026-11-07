import { expect, test } from '@playwright/test'
import { signIn } from './helpers.ts'

test('keeps site choices and the inbox count across client navigation', async ({ page }) => {
  let siteReads = 0
  let inboxReads = 0
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path === '/api/sites') siteReads++
    if (path === '/api/inbox/summary') inboxReads++
  })
  const initialChoices = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sites')
  const initialInbox = page.waitForResponse(response => new URL(response.url()).pathname === '/api/inbox/summary')
  await signIn(page, 'root@example.test')
  expect((await initialChoices).ok()).toBe(true)
  expect((await initialInbox).ok()).toBe(true)
  const shell = page.getByRole('navigation', { name: 'Sections of the CMS' })
  const sidebar = page.getByRole('complementary', { name: 'CMS navigation' })
  await shell.getByRole('link', { name: 'All sites', exact: true }).click()
  await expect(page).toHaveURL(/\/sites$/)
  await shell.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
  })
  expect(siteReads).toBe(1)
  expect(inboxReads).toBe(1)
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sites')
  await page.evaluate(() => window.dispatchEvent(new Event('cms:site-choices-changed')))
  expect((await refreshed).ok()).toBe(true)
  expect(siteReads).toBe(2)

  await shell.getByRole('link', { name: 'All sites', exact: true }).click()
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  const switcher = page.getByRole('button', { name: /^Switch site · Demo site$/ })
  await switcher.click()
  await expect(sidebar.getByRole('link', { name: 'Demo site', exact: true })).toBeVisible()
  await switcher.press('Escape')
  expect(siteReads).toBe(2)

  // Canvas links use real documents. A verified session may reuse its
  // tab-local choices across one of those document changes too.
  await page.reload()
  await switcher.click()
  await expect(sidebar.getByRole('link', { name: 'Demo site', exact: true })).toBeVisible()
  expect(siteReads).toBe(2)
})
