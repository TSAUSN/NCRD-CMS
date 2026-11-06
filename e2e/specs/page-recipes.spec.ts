import { expect, test } from '@playwright/test'
import {
  addSectionButton,
  canvas,
  clickOnCanvas,
  fetchPublic,
  saveDraft,
  signIn,
  treeLabels,
  typeInInspector,
} from './helpers.ts'

test('saves chosen recipe samples, previews, makes independent drafts, and governs Contributor use and retirement', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  await signIn(page, 'editor@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const siteUrl = page.url()
  // Legacy saved-template links retain their existing Editor/Contributor contracts.
  // The admin-only Sections rail no longer advertises authoring to Editors.
  await page.goto(siteUrl + '/recipes')
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+\/recipes$/)
  const recipesUrl = page.url()
  const name = `Conference recipe ${Date.now()}`
  await page.getByText('Save a page as a template', { exact: true }).click()
  await page.getByLabel('Template name', { exact: true }).fill(name)
  await page.getByLabel('Start from a saved page').selectOption({ label: 'A page served by cms-v2' })
  const samples = page.getByLabel('Include this section’s sample content', { exact: true })
  const sectionCount = await samples.count()
  expect(sectionCount).toBeGreaterThan(0)
  await expect(samples.first()).not.toBeChecked()
  await samples.first().check()
  if (sectionCount > 1) {
    await page.getByRole('button', { name: 'Move section 1 down', exact: true }).click()
    await expect(samples.nth(1)).toBeChecked()
    await page.getByRole('button', { name: 'Move section 2 up', exact: true }).click()
    await expect(samples.first()).toBeChecked()
  }
  await page.getByRole('button', { name: 'Save template', exact: true }).click()
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await expect(card).toBeVisible()
  const previewResponse = page.waitForResponse(
    response => response.url().includes('/api/recipes/') && response.url().includes('/preview?'),
  )
  await card.getByRole('button', { name: 'Preview', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Preview ${name}`, exact: true })
  await expect(dialog.frameLocator('iframe').locator('h1')).toBeVisible()
  const sampleHeading = await dialog.frameLocator('iframe').locator('h1').innerText()
  await dialog.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(dialog.locator('iframe')).toHaveCSS('width', '390px')
  const src = await dialog.locator('iframe').getAttribute('src')
  const preview = await previewResponse
  expect(preview.status()).toBe(200)
  expect(preview.headers()['cache-control']).toContain('no-store')
  expect(preview.headers()['content-security-policy']).toContain("script-src 'none'")
  const anonymous = await browser.newContext()
  expect((await anonymous.request.get(new URL(src!, recipesUrl).href)).status()).toBe(404)
  await anonymous.close()
  await page.screenshot({ path: test.info().outputPath('recipe-phone-preview.png') })
  await dialog.getByRole('button', { name: 'Close preview', exact: true }).click()

  await card.getByText('Use this template', { exact: true }).click()
  const pageName = `Recipe copy ${Date.now()}`
  const slug = `recipe-copy-${Date.now()}`
  await card.getByLabel('New page name', { exact: true }).fill(pageName)
  await card.getByLabel('Page address', { exact: true }).fill(slug)
  await card.getByRole('button', { name: 'Create draft & edit page', exact: true }).click()
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
  const independentPageUrl = page.url()
  await expect(treeLabels(page)).toHaveCount(sectionCount)
  await expect(canvas(page).locator('h1')).toHaveText(sampleHeading)
  expect((await fetchPublic(`/${slug}`)).status).toBe(404)

  // Native section insertion belongs to an administrator; legacy template use
  // above and the Contributor's acknowledged append below keep their own roles.
  await page.context().clearCookies()
  await signIn(page, 'root@example.test')
  await page.goto(independentPageUrl)

  // The shelf inserts into the working document, preserving typed text and
  // making the complete recipe a single reversible authoring command.
  const workingHeading = `${sampleHeading} — working copy`
  await clickOnCanvas(page, 'heading')
  await typeInInspector(page, 0, 'heading', workingHeading)
  // As in V1's docked Page Templates (reference 12), each recipe is a card
  // naming its sections in order, beside the page it will join.
  await addSectionButton(page).click()
  await page.getByRole('button', { name: 'Page templates', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Page templates', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const picker = page.getByRole('region', { name: 'Insert a page template', exact: true })
  const recipeCard = picker.getByRole('form', { name, exact: true })
  await expect(
    recipeCard.getByRole('list', { name: `Sections in ${name}`, exact: true }).getByRole('listitem'),
  ).toHaveCount(sectionCount)
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeHidden()
  await expect(page.locator('iframe[title="Page canvas"]')).toBeVisible()
  await recipeCard.getByRole('button', { name: 'Preview', exact: true }).click()
  const fullPreview = page.getByRole('dialog', { name: `Template preview: ${name}`, exact: true })
  await expect(fullPreview.frameLocator('iframe').locator('h1')).toHaveText(sampleHeading)
  await fullPreview.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.screenshot({ path: test.info().outputPath('recipe-docked-shelf.png') })
  await recipeCard.getByRole('button', { name: 'Add these sections', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(treeLabels(page)).toHaveCount(sectionCount * 2)
  await expect(canvas(page).locator('h1').first()).toHaveText(workingHeading)
  await page.screenshot({ path: test.info().outputPath('recipe-working-draft-insertion.png') })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(treeLabels(page)).toHaveCount(sectionCount)
  await expect(canvas(page).locator('h1')).toHaveText(workingHeading)
  await clickOnCanvas(page, 'heading')
  await typeInInspector(page, 0, 'heading', sampleHeading)
  await saveDraft(page)

  const authorContext = await browser.newContext()
  try {
    const author = await authorContext.newPage()
    await signIn(author, 'contributor@example.test')
    await author.goto(recipesUrl)
    await expect(author.getByText('Save a page as a template', { exact: true })).toHaveCount(0)
    const authorCard = author.locator('article').filter({ has: author.getByRole('heading', { name, exact: true }) })
    await authorCard.getByText('Use this template', { exact: true }).click()
    await expect(authorCard.getByLabel('Use template in').locator('option')).not.toContainText(['A new draft page'])
    await authorCard.getByLabel('Use template in').selectOption({ label: `${pageName} — append sections` })
    const acknowledgment = authorCard.getByRole('checkbox', { name: /I have saved my work/ })
    await expect(acknowledgment).not.toBeChecked()
    await authorCard.getByRole('button', { name: 'Add sections & edit page', exact: true }).click()
    await expect(author).toHaveURL(recipesUrl)
    await acknowledgment.check()
    await authorCard.getByRole('button', { name: 'Add sections & edit page', exact: true }).click()
    await expect(author).toHaveURL(independentPageUrl)
    await expect(treeLabels(author)).toHaveCount(sectionCount * 2)
    await expect(canvas(author).locator('h1').first()).toHaveText(sampleHeading)
    await author.screenshot({ path: test.info().outputPath('recipe-contributor-draft.png') })
  } finally {
    await authorContext.close()
  }

  await page.context().clearCookies()
  await signIn(page, 'editor@example.test')
  await page.goto(recipesUrl)
  await card.getByText('Update composition from a saved page', { exact: true }).click()
  await card.getByLabel('Start from a saved page').selectOption({ label: 'A page served by cms-v2' })
  await expect(card.getByLabel('Include this section’s sample content').first()).not.toBeChecked()
  await card.getByRole('button', { name: 'Save updated template', exact: true }).click()
  await expect(card.getByText(/Chosen samples/)).toHaveCount(0)
  await card.getByText('Rename or retire', { exact: true }).click()
  const renamed = `${name} revised`
  await card.getByLabel('Template name', { exact: true }).fill(renamed)
  await card.getByRole('button', { name: 'Rename template', exact: true }).click()
  const renamedCard = page.locator('article').filter({ has: page.getByRole('heading', { name: renamed, exact: true }) })
  await expect(renamedCard).toBeVisible()
  await renamedCard.getByRole('button', { name: 'Retire template', exact: true }).click()
  await expect(renamedCard.getByText('Retired', { exact: true })).toBeVisible()
  await expect(renamedCard.getByText('Use this template', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('recipe-retired-workspace.png') })
  await page.goto(independentPageUrl)
  await expect(treeLabels(page)).toHaveCount(sectionCount * 2)
  await expect(canvas(page).locator('h1').first()).toHaveText(sampleHeading)
  expect((await fetchPublic(`/${slug}`)).status).toBe(404)
  // A retired recipe is no longer offered in the administrator's library.
  await page.context().clearCookies()
  await signIn(page, 'root@example.test')
  await page.goto(independentPageUrl)
  await addSectionButton(page).click()
  await page.getByRole('button', { name: 'Page templates', exact: true }).click()
  const shelf = page.getByRole('region', { name: 'Insert a page template', exact: true })
  await expect(shelf.getByText('Loading templates…')).toHaveCount(0)
  await expect(shelf.getByRole('form', { name: renamed, exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(shelf).toBeHidden()
  await page.goto(siteUrl)
})

test('super admins curate a shared starter and ordinary editors use it without receiving management access', async ({
  page,
  browser,
}) => {
  await signIn(page, 'root@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Sections of the CMS' })
    .locator('summary')
    .filter({ hasText: 'Advanced' })
    .click()
  await page.getByRole('link', { name: 'Sections', exact: true }).click()
  await page.getByRole('link', { name: 'Page templates', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+\/recipes$/)
  const workspace = page.url()
  const name = `Curated event ${Date.now()}`
  const sharedName = `${name} shared`
  await page.getByText('Save a page as a template', { exact: true }).click()
  await page.getByLabel('Template name', { exact: true }).fill(name)
  await page.getByLabel('Start from a saved page').selectOption({ label: 'A page served by cms-v2' })
  const count = await page.getByLabel('Include this section’s sample content', { exact: true }).count()
  await page.getByRole('button', { name: 'Save template', exact: true }).click()
  const original = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await original.getByText('Create a shared starter', { exact: true }).click()
  await original.getByLabel('Shared starter name', { exact: true }).fill(sharedName)
  await original.getByRole('button', { name: 'Create shared starter', exact: true }).click()
  const shared = page.locator('article').filter({ has: page.getByRole('heading', { name: sharedName, exact: true }) })
  await expect(shared).toBeVisible()
  await expect(shared.getByText(/Shared starter/)).toBeVisible()
  await shared.screenshot({ path: test.info().outputPath('recipe-shared-starter.png') })
  const context = await browser.newContext()
  try {
    const editor = await context.newPage()
    await signIn(editor, 'editor@example.test')
    await editor.goto(workspace)
    const card = editor
      .locator('article')
      .filter({ has: editor.getByRole('heading', { name: sharedName, exact: true }) })
    await expect(card.getByText('Rename or retire', { exact: true })).toHaveCount(0)
    await expect(card.getByText('Update composition from a saved page', { exact: true })).toHaveCount(0)
    await card.getByText('Use this template', { exact: true }).click()
    await card.getByLabel('New page name', { exact: true }).fill('Ordinary editor shared starter copy')
    const slug = `shared-starter-${Date.now()}`
    await card.getByLabel('Page address', { exact: true }).fill(slug)
    await card.getByRole('button', { name: 'Create draft & edit page', exact: true }).click()
    await expect(editor).toHaveURL(/\/pages\/[0-9a-f-]+$/)
    await expect(treeLabels(editor)).toHaveCount(count)
    expect((await fetchPublic(`/${slug}`)).status).toBe(404)
  } finally {
    await context.close()
  }
})
