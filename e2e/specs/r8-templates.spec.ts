import { E2E_PORTS } from '../test-ports.ts'
import { CORE_LIBRARY, compileCoreSection } from '@cms/seeds/core-library'
import { renderPage, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION, type SiteShell } from '@cms/renderer'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { expect, test } from '@playwright/test'
import { CORE_PAGE_TEMPLATES, coreTemplateContent } from '@cms/seeds/core-templates'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { signIn, canvas } from './helpers.ts'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
const folder = resolve('../.r8-progress/step-2/templates')
async function capture(page: import('@playwright/test').Page, name: string) {
  await mkdir(folder, { recursive: true })
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    await page.screenshot({ path: resolve(folder, `${name}-${size.width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('page designs create the exact private starting outline, including a useful blank page', async ({ page }) => {
  test.setTimeout(120_000)
  const f = await siteLookFixture(),
    suffix = Date.now().toString(),
    title = 'A welcoming place to meet, learn and build stronger communities together'
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, 'root@example.test')
    const creator = page.getByRole('dialog', { name: 'New page', exact: true })
    const open = async () => {
      await page.goto('/sites/' + f.site + '/pages')
      await page.getByRole('button', { name: 'New page', exact: true }).click()
      await expect(creator.getByRole('button', { name: 'Create draft', exact: true })).toBeDisabled()
    }
    await open()
    await capture(page, 'page-details-empty')
    for (const [index, template] of CORE_PAGE_TEMPLATES.entries()) {
      if (index) await open()
      await creator.getByLabel('Page title', { exact: true }).fill(title)
      await creator.getByRole('button', { name: 'Change', exact: true }).click()
      await creator.getByLabel('Web address', { exact: true }).fill('design-' + template.id + '-' + suffix)
      if (template.id === 'blank') await creator.getByText('A blank page', { exact: true }).click()
      else {
        await creator.getByText('A page design', { exact: true }).click()
        await creator.getByLabel('Page design', { exact: true }).selectOption(template.id)
      }
      await capture(page, 'page-template-' + template.id)
      await creator.getByRole('button', { name: 'Create draft', exact: true }).click()
      await expect(page).toHaveURL(/\/pages\/[a-f0-9-]+$/)
      await expect(canvas(page).getByRole('heading', { name: title, exact: true })).toBeVisible()
      const id = new URL(page.url()).pathname.split('/').at(-1)!,
        saved = (
          await f.pool.query(
            'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [id],
          )
        ).rows[0]!
      expect(saved.published_version_id).toBeNull()
      expect(saved.content).toHaveLength(template.sections.length)
      const definitions = (
        await f.pool.query('SELECT id,slug FROM section_defs WHERE id=ANY($1::uuid[])', [
          saved.content.map((section: { section_def_id: string }) => section.section_def_id),
        ])
      ).rows
      expect(
        saved.content.map(
          (section: { section_def_id: string }) => definitions.find(def => def.id === section.section_def_id)!.slug,
        ),
      ).toEqual(template.sections.map(slug => 'core-' + slug))
      await capture(page, 'created-template-' + template.id)
    }
    await open()
    await creator.getByLabel('Page title', { exact: true }).fill(title)
    await creator.getByRole('button', { name: 'Change', exact: true }).click()
    await creator.getByLabel('Web address', { exact: true }).fill('Not a web address')
    await expect(
      creator.getByText('Use lowercase letters, numbers and hyphens — for example about-us.', { exact: true }),
    ).toBeVisible()
    await expect(creator.getByLabel('Web address', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(creator.getByRole('button', { name: 'Create draft', exact: true })).toBeDisabled()
    await capture(page, 'page-details-error')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})

test('shared page designs keep valid News placeholders, balanced tablet threes, collapsed empty photos and equal logo cards', async ({
  page,
}, info) => {
  const compiled = CORE_LIBRARY.map((entry, index) => ({
      entry,
      id: 'core-' + index,
      compiled: compileCoreSection(entry),
    })),
    defs = compiled.map(row => ({
      id: row.id,
      version: 1,
      slug: row.entry.definition.slug,
      name: row.entry.definition.name,
      slots: row.compiled.slots,
    })),
    folder = resolve('../.r8-progress/round3/template-layout', info.project.name)
  await mkdir(folder, { recursive: true })
  for (const chaptersEnabled of [false, true])
    for (const template of ['echelon-home', 'landing', 'sponsors']) {
      const content = coreTemplateContent(template, defs, '[Template page]'),
        sections = content.map(instance => {
          const row = compiled.find(row => row.id === instance.section_def_id)!
          return {
            instance,
            def: {
              section_def_id: row.id,
              version: 1,
              slug: row.entry.definition.slug,
              compiled_ast: row.compiled.compiledAst,
              css: row.compiled.compiledCss,
              slots: row.compiled.slots,
              definition_kind: row.compiled.definitionKind,
              structured_doc: row.compiled.structuredDoc,
              structured_schema_version: row.compiled.structuredSchemaVersion,
              sanitizer_policy_version: SANITIZER_POLICY_VERSION,
              css_policy_version: CSS_POLICY_VERSION,
            },
          }
        }),
        shell: SiteShell = {
          site: { id: 'site', slug: 'site', name: '[Site]', chaptersEnabled },
          theme: chaptersEnabled
            ? { ...SAWSO_THEME, presentation: { kind: 'panels', canvas: '#d9d9d9' } }
            : SAWSO_THEME,
          navigation: [],
          canonical_host: null,
          staging_host: null,
        },
        html = renderPage({
          manifest: { page: { id: 'page', version_id: 'version', title: '[Page]', path: '/' }, meta: {}, sections },
          shell,
          isStaging: true,
        }).html,
        url = `http://demo.staging.localhost:${E2E_PORTS.site}/template-` + template + '-' + chaptersEnabled
      await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(url)
        await page.locator('main img').evaluateAll(ns =>
          ns.forEach(n => {
            if (n instanceof HTMLImageElement) n.loading = 'eager'
          }),
        )
        await expect
          .poll(() =>
            page
              .locator('main img')
              .evaluateAll(ns => ns.every(n => n instanceof HTMLImageElement && n.complete && n.naturalWidth > 0)),
          )
          .toBe(true)
        if (template === 'echelon-home') {
          const news = page.locator('.cms-section--core-image-link-cards img')
          await expect(news).toHaveCount(2)
          for (const image of await news.all()) await expect(image).toHaveAttribute('src', '/cms-samples/r8-square.png')
        }
        if (width === 1024)
          for (const grid of await page
            .locator('.cms-section--core-icon-cards .core-grid,.cms-section--core-stats .core-grid')
            .all()) {
            const tops = await grid
              .locator(':scope>*')
              .evaluateAll(ns => ns.map(n => Math.round(n.getBoundingClientRect().top)))
            if (tops.length === 3) expect(new Set(tops).size).toBe(1)
          }
        if (chaptersEnabled && template !== 'echelon-home') {
          const row = page.locator('.cms-section--core-text-image .row')
          await expect(row.locator(':scope>:first-child')).toBeHidden()
          const box = await row.boundingBox(),
            copy = await row.locator(':scope>:last-child').boundingBox()
          expect(copy!.width).toBeGreaterThanOrEqual(box!.width - 2)
        }
        if (template === 'sponsors' && width === 390) {
          const heights = await page
            .locator('.core-logos .core-card')
            .evaluateAll(ns => ns.map(n => Math.round(n.getBoundingClientRect().height)))
          expect(heights.length).toBe(4)
          expect(new Set(heights).size).toBe(1)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({
          path: resolve(folder, (chaptersEnabled ? 'echelon' : 'ordinary') + '-' + template + '-' + width + '.png'),
          fullPage: true,
        })
      }
    }
})
