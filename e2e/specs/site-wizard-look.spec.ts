import { expect, test, type Page } from '@playwright/test'
import { THEME_FONT_OPTIONS } from '@cms/schema'
import { signIn } from './helpers.ts'

// The site wizard's Look step (SPEC §6.2 step 2, reference 22): brand colour,
// type pairing and button shape beside a live sample, with a contrast verdict
// that is measured rather than asserted.
const verdicts = (page: Page) => page.getByRole('list', { name: 'Readability' }).getByRole('listitem')
const stack = (label: string) => THEME_FONT_OPTIONS.find(font => font.label === label)!.value

test('chooses a look beside a live sample with honest contrast verdicts, and the new site keeps it', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signIn(page, 'root@example.test')
  await page.goto('/sites/new')
  await page.getByLabel('Site name', { exact: true }).fill('Look step journey')
  await page.getByLabel('Short address', { exact: true }).fill(`look-${Date.now()}`)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Look', exact: true })).toBeVisible()

  // The standard design is chosen to begin with, and the sample names it.
  await expect(page.getByLabel('Navy', { exact: true })).toBeChecked()
  await expect(page.getByLabel('Classic', { exact: true })).toBeChecked()
  await expect(page.getByLabel('Soft', { exact: true })).toBeChecked()
  const sample = page.getByRole('img', { name: /^Sample home page:/ })
  await expect(sample).toHaveAccessibleName('Sample home page: Navy · Classic type · Soft buttons')
  await expect(verdicts(page)).toHaveText([
    'Button labels pass at 11.8:1.',
    'Text in this colour passes at 10.9:1 on the page and on quiet bands.',
  ])
  const button = sample.locator('.wizard-sample-button')

  // Each group is an ordinary radio group: arrow keys move the choice.
  await page.getByLabel('Navy', { exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByLabel('Salvation Army red', { exact: true })).toBeChecked()
  await expect(button).toHaveCSS('background-color', 'rgb(207, 31, 42)')
  await expect(verdicts(page).first()).toHaveText('Button labels pass at 5.4:1.')

  // A light colour of the editor's own gets dark labels and a plain warning
  // about small text; a half-typed value changes nothing.
  const own = page.getByLabel('Or a colour of your own')
  await own.fill('#f2c14e')
  await expect(page.locator('input[name="brand-colour"]:checked')).toHaveCount(0)
  await expect(button).toHaveCSS('color', 'rgb(23, 32, 51)')
  await expect(verdicts(page).first()).toHaveText('Button labels pass at 9.6:1.')
  await expect(verdicts(page).nth(1)).toHaveText(/hard to read at 1\.5:1\. Choose a darker shade\.$/)
  await own.fill('#0f6b7')
  await expect(button).toHaveCSS('background-color', 'rgb(242, 193, 78)')
  await expect(own).toHaveValue('#0f6b7')

  await page.getByLabel('Gold', { exact: true }).check()
  await expect(own).toHaveValue('#8a6a00')
  await page.getByLabel('Editorial', { exact: true }).check()
  await page.getByLabel('Pill', { exact: true }).check()
  await expect(sample.locator('.wizard-sample-heading')).toHaveCSS('font-family', /Iowan Old Style/)
  await expect(button).toHaveCSS('border-radius', '16px')
  await expect(verdicts(page).filter({ hasText: 'hard to read' })).toHaveCount(0)

  // Back and Continue keep every choice, and the review names them.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Gold', { exact: true })).toBeChecked()
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  await expect(page.getByRole('definition').filter({ hasText: 'Gold' })).toHaveText(
    'Gold · Editorial type · Pill buttons',
  )
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await expect(page.getByText('Your new site is private until you publish it.', { exact: false })).toBeVisible()

  // Design opens on exactly the tokens the sample showed.
  await page.getByRole('link', { name: 'Site look', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Site look', exact: true })).toBeVisible()
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#8a6a00')
  await page.getByRole('button', { name: 'Advanced colours', exact: true }).click()
  await expect(page.getByLabel('On primary', { exact: true })).toHaveValue('#ffffff')
  await page.getByText('More font choices', { exact: true }).click()
  await expect(page.getByLabel('Headings', { exact: true })).toHaveValue(stack('Book serif'))
  await expect(page.getByLabel('Body copy', { exact: true })).toHaveValue(stack('Classic serif'))
  await expect(page.getByRole('button', { name: 'Use Pill button shape', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('button', { name: 'Use Pill button shape', exact: true }).locator('[aria-hidden=true]'),
  ).toHaveCSS('border-radius', '16px')
})
