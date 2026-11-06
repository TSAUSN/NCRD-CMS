import { expect, test } from '@playwright/test'
import { addSectionButton, canvas, saveDraft, signIn } from './helpers.ts'

test('organizes pasted source, retains originals, requires current preview, and inserts editable source content', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  await signIn(page, 'root@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const siteUrl = page.url(),
    name = `Organized source ${Date.now()}`
  await page.goto(`${siteUrl}/sections/new`)
  await page.getByRole('button', { name: 'HTML template', exact: true }).click()
  await page.getByLabel('What is this section called?', { exact: true }).fill(name)
  const source =
    '<style>.source-band { padding: 24px; background: #edf2f6; } .source-band h2 { color: #12325b; }</style><section class="source-band"><h2>Research &amp; action</h2><div class="copy"><p>One <strong>cohesive</strong> paragraph.</p><ul><li>First item</li></ul></div><a class="action" href="/">Read more</a></section>'
  await page.getByLabel('HTML', { exact: true }).fill(source)
  await page.getByLabel('CSS', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Organize into blocks', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Editable fields proposed')
  await expect(page.getByLabel('HTML', { exact: true })).toHaveValue(/\{\{heading\}\}/)
  await expect(page.getByLabel('HTML', { exact: true })).not.toHaveValue(/<style>/)
  await page.getByText('Compare with original source', { exact: true }).click()
  await expect(page.getByLabel('Original HTML', { exact: true })).toHaveValue(source)
  await expect(page.getByLabel('Sample content for heading', { exact: true })).toHaveValue('Research & action')
  await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
  const preview = page.frameLocator('iframe[title="Section preview"]')
  await expect(preview.getByRole('heading', { name: 'Research & action', exact: true })).toBeVisible()
  await expect(preview.locator('strong')).toHaveText('cohesive')
  await page
    .locator('#source-change-note')
    .fill('Organize the source band into editable heading, formatted body and link')
  await expect(page.getByRole('button', { name: 'Save this section', exact: true })).toBeEnabled()
  await page.getByLabel('Sample content for heading', { exact: true }).fill('Research for everyone')
  await expect(page.getByRole('button', { name: 'Save this section', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Check and preview', exact: true }).click()
  await expect(preview.getByRole('heading', { name: 'Research for everyone', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('source-organization-review.png') })
  await page.getByRole('button', { name: 'Save this section', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Section saved', exact: true })).toBeVisible()
  await page.goto(siteUrl)
  await page.getByRole('button', { name: 'Add a page', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New page', exact: true })
  await dialog.getByLabel('Page title', { exact: true }).fill('Organized source acceptance')
  await dialog.getByRole('button', { name: 'Change', exact: true }).click()
  await dialog.getByLabel('Web address', { exact: true }).fill(`organized-${Date.now()}`)
  await dialog.getByRole('button', { name: 'Create draft', exact: true }).click()
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
  await addSectionButton(page).click()
  await page
    .locator('#editor-panel-library .section-card')
    .filter({ hasText: name })
    .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
    .click()
  await page
    .getByRole('dialog', { name: 'Add a section', exact: true })
    .getByRole('button', { name: 'Add this section', exact: true })
    .click()
  await expect(canvas(page).getByRole('heading', { name: 'Research for everyone', exact: true })).toBeVisible()
  await canvas(page).getByRole('heading', { name: 'Research for everyone', exact: true }).click()
  const heading = page.getByRole('textbox', { name: /^Heading(?: Changed)?$/ })
  await heading.click()
  await expect(heading).toBeFocused()
  await heading.fill('Ordinary visual editing still works')
  await expect(
    canvas(page).getByRole('heading', { name: 'Ordinary visual editing still works', exact: true }),
  ).toBeVisible()
  await saveDraft(page)
  await page.reload()
  await expect(
    canvas(page).getByRole('heading', { name: 'Ordinary visual editing still works', exact: true }),
  ).toBeVisible()
  await expect(canvas(page).locator('strong').filter({ hasText: 'cohesive' })).toBeVisible()
})

test('names unsupported regions by line and changes nothing until they are corrected by hand', async ({ page }) => {
  await signIn(page, 'root@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  await page.goto(`${page.url()}/sections/new`)
  await page.getByRole('button', { name: 'HTML template', exact: true }).click()
  await page.getByLabel('What is this section called?', { exact: true }).fill(`Unsupported source ${Date.now()}`)
  // A script with content is refused earlier, by the parser; an empty active element reaches the line-by-line review.
  const source =
    '<section class="band">\n<h2>Sign up</h2>\n<iframe src="https://example.org/form"></iframe>\n<p onclick="go()">Tell us more</p>\n</section>'
  await page.getByLabel('HTML', { exact: true }).fill(source)
  await page.getByRole('button', { name: 'Organize into blocks', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Line 3: <iframe> needs manual correction' })).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Line 4: remove the active onclick attribute.' }),
  ).toBeVisible()
  // Nothing is re-tagged or proposed while the source has an unsupported region.
  await expect(page.getByLabel('HTML', { exact: true })).toHaveValue(source)
  await expect(page.getByText('Editable fields proposed', { exact: false })).toHaveCount(0)
})
