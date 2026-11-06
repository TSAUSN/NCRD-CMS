import { expect, test } from '@playwright/test'
import { openSeededPage, signIn, treeLabels } from './helpers.ts'

test('a contributor requests a section and sees the administrator’s response', async ({ page, browser }) => {
  await signIn(page, 'contributor@example.test')
  const sitePath = await page
    .getByRole('main')
    .getByRole('link', { name: 'Demo site', exact: true })
    .getAttribute('href')
  await page.goto(sitePath + '/sections')
  await page.getByText('Request a custom section', { exact: true }).click()
  const title = `Speaker spotlight ${Date.now()}`
  await page.getByLabel('What do you need?', { exact: true }).fill(title)
  await page
    .getByLabel('How should it work?', { exact: true })
    .fill('A portrait, a short biography, and a link to a session.')
  await page.getByRole('button', { name: 'Send request', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Request added to the inbox' })).toBeVisible()
  await page.getByRole('link', { name: 'View requests in the inbox', exact: true }).click()
  const inbox = page
  await expect(inbox).toHaveURL(/\/inbox\?area=advanced#custom-requests$/)
  const contributorCard = inbox
    .locator('.section-request-card')
    .filter({ has: inbox.getByRole('heading', { name: title, exact: true }) })
  await expect(contributorCard).toContainText('open')
  await expect(contributorCard.getByText('Reply or update status', { exact: true })).toHaveCount(0)
  const owner = await browser.newPage()
  try {
    await signIn(owner, 'root@example.test')
    await owner.goto('/inbox?area=advanced#custom-requests')
    const card = owner
      .locator('.section-request-card')
      .filter({ has: owner.getByRole('heading', { name: title, exact: true }) })
    await card.getByText('Reply or update status', { exact: true }).click()
    await card.getByLabel('Request status', { exact: true }).selectOption('completed')
    await card
      .getByLabel('Reply to the team', { exact: true })
      .fill('The new spotlight is ready in the section library.')
    await card.getByRole('button', { name: 'Save reply and status' }).click()
    await expect(card.locator('.chip')).toHaveText('completed')
    await inbox.reload()
    await expect(contributorCard).toContainText('The new spotlight is ready in the section library.')
  } finally {
    await owner.close()
    await inbox.close()
  }
})

test('typing a section request leaves the open editor unchanged and preserves arrow keys', async ({ page }) => {
  await signIn(page, 'contributor@example.test')
  await openSeededPage(page)
  await expect(treeLabels(page).first()).toBeVisible()
  const before = await treeLabels(page).count(),
    editorPath = new URL(page.url()).pathname
  const sitePath = await page
    .getByRole('banner')
    .getByRole('link', { name: 'Demo site', exact: true })
    .getAttribute('href')
  const request = await page.context().newPage()
  try {
    await request.goto(sitePath + '/sections')
    await request.getByText('Request a custom section', { exact: true }).click()
    const body = request.getByLabel('How should it work?', { exact: true })
    await body.fill('Line one')
    await body.press('End')
    await body.press('Enter')
    await body.press('L')
    await expect(body).toHaveValue('Line one\nL')
    await body.press('ArrowLeft')
    expect(await body.evaluate(node => (node as HTMLTextAreaElement).selectionStart)).toBe(9)
    await expect(body).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(editorPath)
    expect(await treeLabels(page).count()).toBe(before)
  } finally {
    await request.close()
  }
})
