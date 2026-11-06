import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { canvas, savedState, signIn } from './helpers.ts'

// Per-link choices in the inspector (SPEC §6.4, V1 reference 08): open in a new
// tab and nofollow, saved with the link and rendered on the page.
async function database() {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  return client
}

async function fixture(page: Page, email = 'root@example.test') {
  const client = await database()
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const cta = (await client.query("SELECT id FROM section_defs WHERE slug='cta' AND scope='global'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        `link-choices-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        'Link choices review',
      ])
    ).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: cta,
          section_def_version: 1,
          label: 'Guide',
          hidden: false,
          hidden_at: [],
          values: { heading: 'Read before you visit', action: { label: 'Read the guide', url: '/guide.pdf' } },
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
  await signIn(page, email)
  await page.goto(`/pages/${pageId}`)
  return pageId
}

async function action(pageId: string) {
  const client = await database()
  try {
    return (
      await client.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content[0].values.action
  } finally {
    await client.end()
  }
}

test('a link can open in a new tab and be marked nofollow, and clearing a choice removes it', async ({ page }) => {
  const pageId = await fixture(page)
  const link = canvas(page).getByRole('link', { name: 'Read the guide' })
  await link.click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await inspector.getByRole('button', { name: 'Change', exact: true }).click()
  const newTab = page.getByRole('dialog', { name: 'Change link', exact: true }).getByLabel(/Open in a new tab/)
  const nofollow = page.getByRole('dialog', { name: 'Change link', exact: true }).getByLabel(/nofollow/)
  await expect(newTab).not.toBeChecked()
  await newTab.check()
  await nofollow.check()
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect
    .poll(() => action(pageId))
    .toEqual({ label: 'Read the guide', url: '/guide.pdf', newTab: true, nofollow: true })
  await expect(canvas(page).getByRole('link', { name: 'Read the guide' })).toHaveAttribute('target', '_blank')
  await expect(canvas(page).getByRole('link', { name: 'Read the guide' })).toHaveAttribute('rel', 'nofollow noopener')

  await newTab.uncheck()
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect.poll(() => action(pageId)).toEqual({ label: 'Read the guide', url: '/guide.pdf', nofollow: true })
  await expect(canvas(page).getByRole('link', { name: 'Read the guide' })).not.toHaveAttribute('target', '_blank')
  await expect(canvas(page).getByRole('link', { name: 'Read the guide' })).toHaveAttribute('rel', 'nofollow')
})

test('a customized button can be large, regular weight and as wide as its column', async ({ page }) => {
  const pageId = await fixture(page)
  await canvas(page).getByRole('link', { name: 'Read the guide' }).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await inspector.getByRole('button', { name: 'Change', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Change link', exact: true })
  await settings.getByText('Advanced', { exact: true }).click()
  await settings.getByText('Button appearance', { exact: true }).click()
  await settings.getByRole('button', { name: 'Customize this button', exact: true }).click()
  await settings.getByLabel('Button size', { exact: true }).selectOption('large')
  await settings.getByLabel('Label weight', { exact: true }).selectOption('regular')
  await settings.getByLabel('Button width', { exact: true }).selectOption('full')
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect
    .poll(async () => (await action(pageId)).buttonAppearance)
    .toEqual({
      style: 'solid',
      color: 'primary',
      radius: 'rounded',
      hover: 'none',
      size: 'large',
      weight: 'regular',
      width: 'full',
    })
  const link = canvas(page).getByRole('link', { name: 'Read the guide' })
  await expect(link).toHaveClass(/cms-button-size-large/)
  await expect(link).toHaveCSS('font-weight', '500')
  // The canvas wraps the field in a boxless element, so measure against the paragraph it sits in.
  const [own, column] = await link.evaluate(node => [
    node.getBoundingClientRect().width,
    node.closest('.cta-action')!.getBoundingClientRect().width,
  ])
  expect(Math.abs(own - column)).toBeLessThan(1)
})

test('native Editors can change link content and behavior without appearance controls', async ({ page }) => {
  const pageId = await fixture(page, 'editor@example.test')
  await canvas(page).getByRole('link', { name: 'Read the guide', exact: true }).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByLabel(/Open in a new tab/)).toHaveCount(0)
  await inspector.getByRole('button', { name: 'Change', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Change link', exact: true })
  await expect(settings.getByLabel('Words people click', { exact: true })).toHaveValue('Read the guide')
  await expect(settings.getByLabel('Open in a new tab', { exact: true })).toBeVisible()
  await expect(settings.getByText('Advanced', { exact: true })).toHaveCount(0)
  await expect(settings.getByText('Button appearance', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
})
