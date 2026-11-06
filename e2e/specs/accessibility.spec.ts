import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn, STAGING_ORIGIN } from './helpers.ts'

test('core authoring workspaces meet automated WCAG AA checks at desktop and tablet sizes', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await signIn(page, 'root@example.test')
  const sitePath = await page
    .getByRole('main')
    .getByRole('link', { name: 'Demo site', exact: true })
    .getAttribute('href')
  expect(sitePath).toMatch(/^\/sites\//)
  const paths = [
    '/',
    sitePath!,
    `${sitePath}/design`,
    `${sitePath}/navigation`,
    `${sitePath}/global-elements`,
    `${sitePath}/media`,
    `${sitePath}/content`,
    `${sitePath}/sections`,
    `${sitePath}/publishing`,
    `${sitePath}/domains`,
    `${sitePath}/settings`,
    '/people',
    '/inbox',
    '/activity',
    '/sites/import',
  ]
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const path of paths) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      // Scriptless site previews are sandboxed without scripts, so axe cannot
      // run inside them; descending into one that attached late hung the scan
      // until the test timed out. Published output has its own audit below.
      // Every frame must still carry a title for assistive technology.
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .exclude('iframe[sandbox]')
        .analyze()
      expect
        .soft(
          await page
            .locator('iframe')
            .evaluateAll(frames => frames.filter(frame => !frame.getAttribute('title')?.trim()).length),
          `${width}px ${path} untitled frames`,
        )
        .toBe(0)
      if (scan.violations.length)
        await testInfo.attach(`accessibility-${width}-${path.replaceAll('/', '-')}`, {
          body: JSON.stringify(scan.violations, null, 2),
          contentType: 'application/json',
        })
      expect
        .soft(
          scan.violations.map(item => ({
            id: item.id,
            impact: item.impact,
            nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
          })),
          `${width}px ${path}`,
        )
        .toEqual([])
    }
  }
})

test('published archetype is readable without JavaScript and passes automated AA checks', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  const start = Date.now()
  const response = await page.goto(STAGING_ORIGIN)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const bytes = (await response!.body()).length
  await testInfo.attach('public-response-measurement', {
    body: JSON.stringify({
      environment: 'local-production-build',
      responseMilliseconds: Date.now() - start,
      htmlBytes: bytes,
    }),
    contentType: 'application/json',
  })
  expect(bytes).toBeLessThan(250_000)
  await context.close()
  const auditContext = await browser.newContext()
  const auditPage = await auditContext.newPage()
  await auditPage.goto(STAGING_ORIGIN)
  const result = await new AxeBuilder({ page: auditPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(result.violations).toEqual([])
  await auditContext.close()
})
