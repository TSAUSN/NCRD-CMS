import { test, expect } from '@playwright/test'
import { Pool } from 'pg'
import { signIn } from './specs/helpers.ts'
import { e2eTarget } from './test-target.ts'

const target = e2eTarget()
const pool = new Pool({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
test.afterAll(async () => {
  await pool.end()
})

test('adds an editor without mail, retains restricted view and deactivates their open session', async ({
  page,
  browser,
}, info) => {
  await signIn(page, 'root@example.test')
  await page.goto('/people')
  await expect(page.getByRole('button', { name: 'Invite a person', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add a person', exact: true }).click()
  const form = page.getByRole('region', { name: 'Add a person', exact: true }),
    email = `no-mail-${Date.now()}@example.test`
  await form.getByLabel('Name', { exact: true }).fill('No-mail editor')
  await form.getByLabel('Email address').fill(email)
  await form.getByLabel('Demo site', { exact: true }).selectOption('editor')
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(form.getByRole('button', { name: 'Add person', exact: true })).toBeInViewport()
    await page.screenshot({ path: info.outputPath(`add-person-${width}.png`) })
  }
  await form.getByRole('button', { name: 'Add person', exact: true }).click()
  const row = page.getByRole('table', { name: 'People and access' }).getByRole('row').filter({ hasText: email })
  await expect(row.getByText('Not signed in yet', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'No invitation email was sent' })).toBeVisible()
  const person = (await pool.query('SELECT id,auth_subject FROM app_users WHERE email=$1', [email])).rows[0]
  expect(person.auth_subject).toBeNull()
  expect(
    (await pool.query("SELECT id FROM outbox WHERE event_type='user.invited' AND payload->>'user_id'=$1", [person.id]))
      .rows,
  ).toEqual([])
  expect(
    (await pool.query("SELECT id FROM audit_log WHERE action='user.add' AND item_id=$1", [person.id])).rows,
  ).toHaveLength(1)
  const assignments = (await pool.query('SELECT site_id,role FROM site_memberships WHERE user_id=$1', [person.id])).rows
  expect(assignments).toHaveLength(1)
  expect(assignments[0].role).toBe('editor')
  const editorContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const editor = await editorContext.newPage()
    await signIn(editor, email)
    await expect(editor.getByRole('link', { name: 'Demo site', exact: true })).toBeVisible()
    await editor.goto('/people')
    await expect(editor.getByRole('heading', { name: 'Your access', exact: true })).toBeVisible()
    await expect(editor.getByRole('table', { name: 'People and access' })).toHaveCount(0)
    await expect(editor.getByRole('button', { name: 'Add a person', exact: true })).toHaveCount(0)
    const denied = await editor.goto('/sites/' + assignments[0].site_id + '/header')
    expect(denied?.status()).toBe(404)
    await row.getByRole('button', { name: 'Edit access for ' + email }).click()
    await page.getByLabel('Account status').selectOption('disabled')
    await page.getByRole('button', { name: 'Save account access', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Deactivate No-mail editor?' })
      .getByRole('button', { name: 'Deactivate account', exact: true })
      .click()
    await expect(row.getByText('Deactivated', { exact: true })).toBeVisible()
    await editor.goto('/')
    await expect(editor.getByRole('heading', { name: 'You are not signed in', exact: true })).toBeVisible()
  } finally {
    await editorContext.close()
  }
})
