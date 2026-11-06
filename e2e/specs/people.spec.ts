import { E2E_PORTS } from '../test-ports.ts'
import { expect, test } from '@playwright/test'
import { signIn } from './helpers.ts'

test('invites an assigned contributor and deactivates their already-open session', async ({ page, browser }) => {
  await signIn(page, 'root@example.test')
  await page.getByRole('link', { name: 'People & access' }).click()
  await page.getByRole('button', { name: 'Invite a person' }).click()
  const email = `people-${Date.now()}@example.test`
  const editor = page.getByRole('region', { name: 'Invite a person' })
  await editor.getByLabel('Name', { exact: true }).fill('People workflow test')
  await editor.getByLabel('Email address').fill(email)
  await editor.getByLabel('Demo site', { exact: true }).selectOption('contributor')
  await editor.getByRole('button', { name: 'Create account & send invitation' }).click()
  const person = page
    .getByRole('table', { name: 'People and access', exact: true })
    .locator('tbody tr')
    .filter({ hasText: email })
  await expect(person).toBeVisible()
  await expect(person.getByText('Invitation queued', { exact: true })).toBeVisible()

  const invitedContext = await browser.newContext({ baseURL: `http://127.0.0.1:${E2E_PORTS.admin}` })
  try {
    const invited = await invitedContext.newPage()
    await signIn(invited, email)
    await expect(invited.getByRole('link', { name: 'Demo site', exact: true })).toBeVisible()
    await expect(invited.getByRole('link', { name: 'People & access', exact: true })).toHaveCount(0)
    await invited.goto('/people')
    await expect(invited.getByRole('heading', { name: 'Your access' })).toBeVisible()
    await expect(invited.getByRole('button', { name: 'Invite a person' })).toHaveCount(0)

    await person.getByRole('button', { name: `Edit access for ${email}` }).click()
    await page.getByLabel('Account status').selectOption('disabled')
    await page.getByRole('button', { name: 'Save account access' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Deactivate People workflow test?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Deactivate account' }).click()
    await expect(person.getByText('Deactivated', { exact: true })).toBeVisible()
    await invited.goto('/')
    await expect(invited.getByRole('heading', { name: 'You are not signed in' })).toBeVisible()
    await expect(invited.getByRole('link', { name: 'Demo site', exact: true })).toHaveCount(0)
  } finally {
    await invitedContext.close()
  }
})

test('preserves an unsaved invitation when the operator cancels switching forms', async ({ page }) => {
  await signIn(page, 'root@example.test')
  await page.goto('/people')
  await page.getByRole('button', { name: 'Invite a person' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Unfinished invitation')
  await page
    .getByRole('table', { name: 'People and access', exact: true })
    .locator('tbody tr')
    .first()
    .getByRole('button', { name: /Edit access/ })
    .click()
  const dialog = page.getByRole('alertdialog', { name: 'Before you leave' })
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unfinished invitation')
})
