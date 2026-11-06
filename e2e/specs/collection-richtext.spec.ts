import { E2E_PORTS } from '../test-ports.ts'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
function database() {
  return new Pool({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
}
async function resources(page: Page, { release = false }: { release?: boolean } = {}) {
  page.setDefaultTimeout(10_000)
  page.setDefaultNavigationTimeout(15_000)
  await signIn(page, 'root@example.test')
  await page.goto('/sites/new')
  const slug = `rich-resources-${randomUUID().slice(0, 8)}`
  await page.getByLabel('Site name', { exact: true }).fill('Collection writing test')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await expect(page.getByText('Your new site is private until you publish it.', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+/)
  const siteId = page.url().match(/\/sites\/([0-9a-f-]+)/)![1]!
  if (release) {
    // A new site stays private until its first complete release (SITE-01).
    await page.getByRole('main').getByRole('link', { name: 'Publish', exact: true }).click()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
  }
  await page
    .getByRole('navigation', { name: 'Sections of the CMS' })
    .getByRole('link', { name: 'Lists', exact: true })
    .click()
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Resources / })
    .click()
  await expect(page).toHaveURL(/collection=[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible()
  return { siteId, slug, url: page.url() }
}
const rich = (page: Page) =>
  page.locator('.collection-field').filter({ has: page.locator('label').filter({ hasText: 'Summary' }) })
async function appendKey(page: Page, suffix: string) {
  const key = page.getByLabel('Record key', { exact: true })
  if (!(await key.isVisible())) await page.getByRole('dialog').getByText('Advanced', { exact: true }).click()
  const id = await key.getAttribute('id')
  const before = await key.inputValue()
  await key.focus()
  await key.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await key.pressSequentially(suffix)
  await expect(key).toBeFocused()
  await expect(key).toHaveValue(before + suffix)
  await expect(key).toHaveAttribute('id', id!)
  await expect(page.getByRole('dialog')).toHaveCount(1)
}
async function save(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Save resource', exact: true }).click()
  await expect(page.getByText('List draft saved. The live site is unchanged.')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function edit(page: Page, title: string) {
  await page.getByRole('button', { name: 'Edit ' + title, exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit resource', exact: true })).toBeVisible()
}
async function archiveSite(siteId: string) {
  const pool = database()
  try {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query("SELECT set_config('app.user_id',$1,true)", [root])
      await c.query('SELECT app.archive_site(id,revision) FROM sites WHERE id=$1', [siteId])
      await c.query('COMMIT')
    } finally {
      c.release()
    }
  } finally {
    await pool.end()
  }
}

test('keeps new and duplicated stable keys focused and publishes visually formatted collection text', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const f = await resources(page, { release: true })
  try {
    await page.getByRole('button', { name: 'Add resource', exact: true }).click()
    await appendKey(page, '-community-support')
    await page.getByRole('textbox', { name: /^Resource title(?:\s*required)?$/ }).fill('Community resource')
    await page.getByRole('textbox', { name: /^Open resource(?:\s*required)?$/ }).fill('https://example.org/resource')
    // Plain-text values are retained exactly until the user actually edits them.
    await rich(page).getByRole('button', { name: 'HTML source', exact: true }).click()
    await rich(page).getByLabel('HTML source', { exact: true }).fill('Original & plain summary')
    await save(page)
    await page.reload()
    await edit(page, 'Community resource')
    const field = rich(page)
    const editor = field.getByRole('textbox', { name: 'Summary', exact: true })
    await expect(editor).toHaveText('Original & plain summary')
    await expect(page.getByText('Unsaved changes')).toHaveCount(0)
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Save resource', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
    const pool = database()
    try {
      const stored = (
        await pool.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.site_id=$1',
          [f.siteId],
        )
      ).rows[0]!.values
      expect(stored.summary).toBe('Original & plain summary')
    } finally {
      await pool.end()
    }
    await editor.fill('Community help')
    await editor.press('ControlOrMeta+a')
    await field.getByRole('button', { name: 'Bold', exact: true }).click()
    await expect(editor.locator('strong')).toHaveText('Community help')
    await editor.press('ControlOrMeta+a')
    await field.getByRole('button', { name: 'Add or edit link' }).click()
    await field.getByLabel('Where the link goes').fill('javascript:alert(1)')
    await field.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(field.getByRole('alert')).toContainText('Enter a safe site path')
    await field.getByLabel('Where the link goes').fill('https://example.org/support')
    await field.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.org/support')
    await save(page)
    expect((await rawRequest({ host: `${f.slug}.staging.localhost`, path: '/resources' })).body).not.toContain(
      'Community help',
    )
    await page.getByRole('button', { name: 'Publish list', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish this list', exact: true }).click()
    await expect(page.getByText('1 item is now live.')).toBeVisible()
    const live = await rawRequest({ host: `${f.slug}.staging.localhost`, path: '/resources' })
    expect(live.status).toBe(200)
    expect(live.body).toContain('Community help')
    expect(live.body).toContain('href="https://example.org/support"')
    expect(live.body).toContain('<strong>')
    await edit(page, 'Community resource')
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await appendKey(page, '-second')
    await page.getByRole('textbox', { name: /^Resource title(?:\s*required)?$/ }).fill('Second resource')
    await save(page)
    const verify = database()
    try {
      const records = (
        await verify.query(
          'SELECT e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.site_id=$1 ORDER BY e.stable_key',
          [f.siteId],
        )
      ).rows
      expect(records).toHaveLength(2)
      expect(records[1]!.stable_key).toMatch(/-second$/)
      expect(records.every(record => !Object.hasOwn(record.values, 'clientId'))).toBe(true)
    } finally {
      await verify.end()
    }
  } finally {
    await archiveSite(f.siteId)
  }
})

test('keeps archived rich text read-only and denies a disabled account after reloading', async ({ page, browser }) => {
  test.setTimeout(90_000)
  const f = await resources(page)
  try {
    await page.getByRole('button', { name: 'Add resource', exact: true }).click()
    await page.getByRole('textbox', { name: /^Resource title(?:\s*required)?$/ }).fill('Read-only resource')
    await page.getByRole('textbox', { name: /^Open resource(?:\s*required)?$/ }).fill('https://example.org/resource')
    await rich(page).getByRole('textbox', { name: 'Summary', exact: true }).fill('Preserved content')
    await save(page)
    await edit(page, 'Read-only resource')
    await page.getByRole('button', { name: 'Hide from list', exact: true }).click()
    await save(page)
    await page.getByRole('group', { name: 'Filter items' }).getByRole('button', { name: 'Hidden', exact: true }).click()
    await edit(page, 'Read-only resource')
    const field = rich(page)
    const editor = field.getByRole('textbox', { name: 'Summary', exact: true })
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    await expect(editor).toHaveAttribute('aria-readonly', 'true')
    await expect(field.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled()
    await expect(field.getByRole('button', { name: 'Add or edit link' })).toBeDisabled()
    await field.getByRole('button', { name: 'HTML source', exact: true }).click()
    await expect(field.getByLabel('HTML source', { exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Show in list', exact: true }).click()
    await save(page)
    await expect(page.getByText('Unsaved changes')).toHaveCount(0)
    const pool = database()
    const email = `collection-reader-${randomUUID()}@example.test`
    let userId = ''
    try {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        const root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
        await c.query("SELECT set_config('app.user_id',$1,true)", [root])
        userId = (await c.query('SELECT app.provision_user($1,$2) AS id', [email, 'Collection contributor'])).rows[0]!
          .id
        await c.query("SELECT app.set_site_membership($1,$2,'contributor')", [userId, f.siteId])
        await c.query('COMMIT')
      } finally {
        c.release()
      }
      const context = await browser.newContext({ baseURL: `http://127.0.0.1:${E2E_PORTS.admin}` })
      context.setDefaultTimeout(10_000)
      context.setDefaultNavigationTimeout(15_000)
      try {
        const other = await context.newPage()
        await signIn(other, email)
        await other.goto(f.url)
        await edit(other, 'Read-only resource')
        await expect(rich(other).getByRole('textbox', { name: 'Summary', exact: true })).toHaveAttribute(
          'contenteditable',
          'true',
        )
        await pool.query("UPDATE app_users SET status='disabled' WHERE id=$1", [userId])
        await other.reload()
        await expect(other.getByRole('textbox', { name: 'Summary', exact: true })).toHaveCount(0)
        await expect(other.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0)
      } finally {
        await context.close()
      }
    } finally {
      await pool.end()
    }
  } finally {
    await archiveSite(f.siteId)
  }
})

test('opens the named content form from the page inspector while preserving the page tab', async ({ page }) => {
  test.setTimeout(90_000)
  const f = await resources(page, { release: true })
  try {
    await page
      .getByRole('navigation', { name: 'Sections of the CMS' })
      .getByRole('link', { name: 'Pages', exact: true })
      .click()
    await page.getByRole('main').getByRole('link', { name: 'Resources', exact: true }).click()
    await page.frameLocator('iframe[title="Page canvas"]').locator('[data-cms-slot="resources"]').first().click()
    const edit = page.getByRole('link', { name: 'Edit Resources', exact: true })
    await expect(edit).toBeVisible()
    await expect(edit).toHaveAttribute('href', new RegExp(`/sites/${f.siteId}/content\\?collection=[0-9a-f-]+$`))
    const newTab = page.waitForEvent('popup')
    await edit.click()
    const content = await newTab
    await expect(content).toHaveURL(new RegExp(`/sites/${f.siteId}/content\\?collection=[0-9a-f-]+$`))
    await expect(content.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
    await content.close()
  } finally {
    await archiveSite(f.siteId)
  }
})
