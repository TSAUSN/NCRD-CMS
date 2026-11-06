import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { signIn } from './helpers.ts'

// The wizard's Name, Pages and Header & footer steps against V1 references 21,
// 23 and 24: a one-line description, a starting layout and menu choice for each
// planned page, and the header's layout and colour chosen by sight.
test('describes the site once, plans which pages join the menu, and draws the header it will have', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signIn(page, 'root@example.test')
  await page.goto('/sites/new')
  const slug = `pages-plan-${Date.now()}`
  await page.getByLabel('Site name', { exact: true }).fill('Planned pages journey')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  const line = 'Practical help for families across the region.'
  await page.getByLabel('One line about the site', { exact: true }).fill(line)
  const sample = page.getByRole('img', { name: /^Sample home page:/ })
  await expect(sample.locator('.wizard-sample-intro')).toHaveText(line)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()

  // The description is the home page's introduction.
  await expect(page.getByLabel('Introduction').first()).toHaveValue(line)
  const about = page
    .locator('.wizard-page')
    .filter({ has: page.locator('summary').filter({ hasText: 'About this project' }) })
  await about.locator('summary').click()
  await expect(about.getByLabel('Page template')).toHaveValue('blank')
  await expect(about.getByLabel('Page template').locator('option')).toHaveText([
    'Echelon national home',
    'Find a chapter',
    'Event home',
    'Speakers',
    'Program',
    'Plan your visit',
    'Sponsors / exhibitors',
    'Resource page',
    'Landing page',
    'Chapter page',
    'Blank page',
  ])
  await about.getByLabel(/Show in the site menu/).uncheck()
  await expect(about.locator('summary')).toContainText('not in the menu')
  // The sample's menu follows the plan.
  await expect(sample.locator('.wizard-sample-nav')).toHaveText(/Home\s*Resources$/)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Header & footer', exact: true })).toBeVisible()
  await expect(page.getByLabel('Footer introduction')).toHaveValue(line)
  await page.getByLabel('Centred', { exact: true }).check()
  await page.getByLabel('Brand colour', { exact: true }).check()
  await expect(sample.locator('.wizard-sample-header')).toHaveClass(/is-surface-primary/)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  await expect(
    page.getByRole('list', { name: 'Planned pages' }).getByRole('listitem').filter({ hasText: 'About this project' }),
  ).toContainText('Blank page · not in the menu')
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await expect(page.getByText('Your new site is private until you publish it.', { exact: false })).toBeVisible()

  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  try {
    const site = (await client.query('SELECT id FROM sites WHERE slug=$1', [slug])).rows[0]!.id
    const titles = new Map(
      (await client.query('SELECT id,title FROM pages WHERE site_id=$1', [site])).rows.map(row => [row.id, row.title]),
    )
    expect([...titles.values()].sort()).toEqual(['About this project', 'Home', 'Resources'])
    const tree = (
      await client.query(
        'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [site],
      )
    ).rows[0]!.tree
    expect(tree.map((item: { target: { page_id: string } }) => titles.get(item.target.page_id))).toEqual([
      'Home',
      'Resources',
    ])
    const header = (
      await client.query(
        "SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='header'",
        [site],
      )
    ).rows[0]!.content
    expect(header).toMatchObject({ preset: 'centered', surface: 'primary' })
    const footer = (
      await client.query(
        "SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='footer'",
        [site],
      )
    ).rows[0]!.content
    expect(footer.brand.blurb).toBe(line)
  } finally {
    await client.end()
  }
})

// V1 reference 23: “Nest puts a page underneath the one above it, which is how a
// drop-down appears in the menu”, and a page can be “In the footer”.
test('nests a page under the one above it, lists the chosen pages in the footer and plans links for every page', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signIn(page, 'root@example.test')
  await page.goto('/sites/new')
  const slug = `nested-plan-${Date.now()}`
  await page.getByLabel('Site name', { exact: true }).fill('Nested pages journey')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()
  const row = (title: RegExp) =>
    page.locator('.wizard-page').filter({ has: page.locator('summary').filter({ hasText: title }) })
  const resources = row(/^Resources/),
    about = row(/^About this project/)
  await resources.locator('summary').click()
  // The home page always stays at the top, so nothing nests under it.
  await expect(resources.getByRole('button', { name: 'Nest under the page above' })).toBeDisabled()
  await about.locator('summary').click()
  await about.getByRole('button', { name: 'Nest under the page above' }).click()
  await about.getByLabel(/Show in the footer/).check()
  await expect(about.locator('summary')).toContainText('Blank page · under Resources · in the footer')
  await expect(about).toHaveClass(/is-nested/)
  const sample = page.getByRole('img', { name: /^Sample home page:/ })
  await expect(sample.locator('.wizard-sample-nav')).toHaveText(/Home\s*Resources ▾$/)
  // Un-nesting brings it back to the top level; nesting again restores the plan.
  await about.getByRole('button', { name: 'Un-nest' }).click()
  await expect(sample.locator('.wizard-sample-nav')).toHaveText(/Home\s*Resources\s*About this project$/)
  await about.getByRole('button', { name: 'Nest under the page above' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Header & footer', exact: true })).toBeVisible()

  // An optional partner beside the brand, and links every page shows, to web
  // addresses (SPEC §6 step 4).
  await page.getByLabel(/Name a partner in the header/).check()
  await expect(page.getByLabel('Words before the name', { exact: true })).toHaveValue('In partnership with')
  await page.getByLabel('Partner’s name', { exact: true }).fill('Lilly Family School of Philanthropy')
  await page.getByLabel('Web address (optional)', { exact: true }).fill('https://philanthropy.example.test/')
  await expect(sample.locator('.wizard-sample-partner')).toHaveText(
    'In partnership with Lilly Family School of Philanthropy',
  )
  await page.getByRole('button', { name: 'Add a header link' }).click()
  const headerLink = page.getByRole('group', { name: 'Header links 1' })
  await headerLink.getByLabel('Link text').fill('Donate')
  await headerLink.getByLabel('Web address').fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Use an internal path or an https URL without credentials.' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Header & footer', exact: true })).toBeVisible()
  await headerLink.getByLabel('Web address').fill('https://give.example.org/')
  await page.getByRole('button', { name: 'Add a footer link' }).click()
  const footerLink = page.getByRole('group', { name: 'Footer links 1' })
  await footerLink.getByLabel('Link text').fill('Annual report')
  await footerLink.getByLabel('Web address').fill('/report')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  await expect(page.locator('.wizard-review')).toContainText('Header: Donate · Footer: Annual report')
  await expect(page.locator('.wizard-review')).toContainText('In partnership with Lilly Family School of Philanthropy')
  await expect(
    page.getByRole('list', { name: 'Planned pages' }).getByRole('listitem').filter({ hasText: 'About this project' }),
  ).toContainText('Blank page · under Resources · in the footer')
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await expect(page.getByText('Your new site is private until you publish it.', { exact: false })).toBeVisible()

  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  try {
    const site = (await client.query('SELECT id FROM sites WHERE slug=$1', [slug])).rows[0]!.id
    const titles = new Map(
      (await client.query('SELECT id,title FROM pages WHERE site_id=$1', [site])).rows.map(row => [row.id, row.title]),
    )
    type Item = { target: { page_id: string }; children?: Item[] }
    const tree = (
      await client.query(
        'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [site],
      )
    ).rows[0]!.tree as Item[]
    expect(
      tree.map(item => [
        titles.get(item.target.page_id),
        (item.children ?? []).map(child => titles.get(child.target.page_id)),
      ]),
    ).toEqual([
      ['Home', []],
      ['Resources', ['About this project']],
    ])
    const footer = (
      await client.query(
        "SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='footer'",
        [site],
      )
    ).rows[0]!.content
    expect(
      footer.groups.map((group: { heading: string; links: { label: string }[] }) => [
        group.heading,
        group.links.map(link => link.label),
      ]),
    ).toEqual([
      ['On this site', ['About this project']],
      ['Useful links', ['Annual report']],
    ])
    expect(
      footer.groups[0].links.map((link: { target: { page_id: string } }) => titles.get(link.target.page_id)),
    ).toEqual(['About this project'])
    const header = (
      await client.query(
        "SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='header'",
        [site],
      )
    ).rows[0]!.content
    expect(header.utilityLinks).toEqual([
      { label: 'Donate', target: { type: 'url', url: 'https://give.example.org/' } },
    ])
    expect(header.partner).toEqual({
      label: 'In partnership with',
      name: 'Lilly Family School of Philanthropy',
      url: 'https://philanthropy.example.test/',
    })
    // The site's own header preview names the partner beside the brand.
    await page.goto(`/sites/${site}/global-elements`)
    const preview = page.frameLocator('iframe[title$="header and footer preview"]')
    await expect(preview.locator('.cms-global-header-partner')).toHaveText(
      'In partnership with Lilly Family School of Philanthropy',
    )
    await expect(preview.getByRole('link', { name: 'Lilly Family School of Philanthropy' })).toHaveAttribute(
      'href',
      'https://philanthropy.example.test/',
    )
    await expect(page.getByLabel('Partner’s name', { exact: true })).toHaveValue('Lilly Family School of Philanthropy')
  } finally {
    await client.end()
  }
})
