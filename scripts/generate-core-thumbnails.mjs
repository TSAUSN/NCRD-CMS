// Offline, reproducible neutral fallback captures. No database or environment files.
import { createRequire } from 'node:module'
import { readFile, mkdir, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_LIBRARY, compileCoreSection, corePreviewValues } from '../packages/seeds/src/core-library.ts'
import { ECHELON_DIRECTORY_CSS } from '../packages/renderer/src/echelon-directory-presentation.ts'
import { ECHELON_PRESENTATION_CSS } from '../packages/renderer/src/echelon-presentation.ts'
import {
  ECHELON_BODY_CSS,
  ECHELON_STORY_CARDS_CSS,
  ECHELON_SECTION_LINK_CSS,
} from '../packages/renderer/src/echelon-body-presentation.ts'
import { SITE_WIDGET_CSS } from '../packages/renderer/src/site-widgets.ts'
import { CORE_THEME_PRESETS } from '../packages/seeds/src/core-themes.ts'
import {
  renderSection,
  themeCss,
  collectCss,
  SANITIZER_POLICY_VERSION,
  CSS_POLICY_VERSION,
} from '../packages/renderer/src/index.ts'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = createRequire(resolve(root, 'e2e/package.json'))('@playwright/test')
const sharp = createRequire(resolve(root, 'apps/admin/package.json'))('sharp')
const folder = resolve(root, 'apps/admin/public/cms-samples/sections')
await mkdir(folder, { recursive: true })
const files = new Map()
for (const file of [
  'r8-landscape.png',
  'r8-four-three.png',
  'r8-square.png',
  'fonts/open-sans-latin-400-normal.woff2',
  'fonts/open-sans-latin-700-normal.woff2',
  'fonts/material-symbols-outlined-latin-400-normal.woff2',
]) {
  const bytes = await readFile(resolve(root, 'apps/admin/public/cms-samples', file))
  files.set(
    `/cms-samples/${file}`,
    `data:${file.endsWith('.png') ? 'image/png' : 'font/woff2'};base64,${bytes.toString('base64')}`,
  )
}
files.set(
  '/cms-themes/echelon/us-map.svg',
  'data:image/svg+xml;base64,' +
    (await readFile(resolve(root, 'apps/admin/public/cms-themes/echelon/us-map.svg'))).toString('base64'),
)
let generated = 0
const missingOnly = process.argv.includes('--missing')
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    javaScriptEnabled: false,
    offline: true,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.route('**/*', route => route.abort())
  for (const entry of CORE_LIBRARY) {
    if (
      missingOnly &&
      (await access(resolve(folder, `${entry.definition.slug}.png`)).then(
        () => true,
        () => false,
      ))
    )
      continue
    const compiled = compileCoreSection(entry)
    const section = {
      def: {
        section_def_id: 'core',
        version: 1,
        slug: entry.definition.slug,
        compiled_ast: compiled.compiledAst,
        css: compiled.compiledCss,
        slots: compiled.slots,
        definition_kind: compiled.definitionKind,
        structured_doc: compiled.structuredDoc,
        structured_schema_version: compiled.structuredSchemaVersion,
        sanitizer_policy_version: SANITIZER_POLICY_VERSION,
        css_policy_version: CSS_POLICY_VERSION,
      },
      instance: { section_def_id: 'core', section_def_version: 1, values: corePreviewValues(entry) },
    }
    let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${themeCss(CORE_THEME_PRESETS[1].theme, true)}${collectCss([section])}${SITE_WIDGET_CSS}${entry.definition.slug.startsWith('core-echelon-') ? ECHELON_PRESENTATION_CSS + ECHELON_BODY_CSS + ECHELON_STORY_CARDS_CSS + ECHELON_SECTION_LINK_CSS + ECHELON_DIRECTORY_CSS : ''}</style></head><body><main id="cms-main">${renderSection(section, 0, { providerEmbeds: false, siteThemeHooks: true })}</main></body></html>`
    for (const [url, data] of files) html = html.replaceAll(url, data)
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const png = await page.locator('#s0').screenshot({ animations: 'disabled' })
    generated++
    await sharp(png)
      .resize({ width: 640 })
      .png()
      .toFile(resolve(folder, `${entry.definition.slug}.png`))
  }
  await context.close()
} finally {
  await browser.close()
}
console.log(`Generated ${generated} section-only fallback thumbnails offline.`)
