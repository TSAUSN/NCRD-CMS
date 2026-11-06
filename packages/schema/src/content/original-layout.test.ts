import { describe, it, expect } from 'vitest'
import { SiteFileBundle, EMPTY_SITE_FILE_BUNDLE } from './site-files.ts'
import { OriginalDocumentAttributes, SiteOriginalLayout } from './original-layout.ts'
const id = '11111111-1111-4111-a111-111111111111'
const page = {
  pageId: id,
  html: { lang: 'en' },
  body: { 'data-bs-spy': 'scroll', 'data-bs-target': '.fixed-top' },
  header: true,
  footer: false,
}
const layout = { version: 1, definitions: [{ section_def_id: id, section_def_version: 1 }], pages: [page] }
describe('reviewed original document structure', () => {
  it('is optional, closed, and preserves source attributes and exact pins', () => {
    expect(SiteFileBundle.parse(EMPTY_SITE_FILE_BUNDLE)).toEqual(EMPTY_SITE_FILE_BUNDLE)
    expect(SiteFileBundle.parse({ ...EMPTY_SITE_FILE_BUNDLE, original: layout }).original).toEqual(layout)
  })
  it.each([
    'onload',
    'onclick',
    'style',
    'src',
    'href',
    'xmlns',
    'data-cms-section',
    'data-cms',
    'DATA-test',
    '__proto__',
  ])('refuses an active or reserved attribute: %s', name => {
    expect(OriginalDocumentAttributes.safeParse(JSON.parse('{"' + name + '":"value"}')).success).toBe(false)
  })
  it('escapes values at rendering rather than pretending attributes contain markup', () => {
    expect(OriginalDocumentAttributes.parse({ class: 'a & b', 'aria-label': 'A "quote" <here>' })).toEqual({
      class: 'a & b',
      'aria-label': 'A "quote" <here>',
    })
  })
  it('bounds attributes and rejects invalid direction/control characters', () => {
    for (const attributes of [
      { dir: 'down' },
      { class: '\0' },
      { id: '\n' },
      { class: 'x'.repeat(4097) },
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['data-value-' + i, 'x'])),
    ])
      expect(OriginalDocumentAttributes.safeParse(attributes).success).toBe(false)
  })
  it('refuses duplicate or missing identities, future shapes and executable content', () => {
    for (const original of [
      { ...layout, definitions: [...layout.definitions, ...layout.definitions] },
      { ...layout, pages: [page, page] },
      { ...layout, script: 'run()' },
      { ...layout, pages: [{ ...page, body: { onload: 'run()' } }] },
      { ...layout, definitions: [{ ...layout.definitions[0], section_def_version: 2147483648 }] },
    ])
      expect(SiteOriginalLayout.safeParse(original).success).toBe(false)
  })
})

it('limits original browser mode to a boolean rather than HTML or a mode string', () => {
  const page = { pageId: id, html: {}, body: {}, header: false, footer: false }
  expect(
    SiteOriginalLayout.safeParse({ version: 1, definitions: [], pages: [{ ...page, quirks: true }] }).success,
  ).toBe(true)
  for (const quirks of ['true', '<!doctype html>', {}, null])
    expect(SiteOriginalLayout.safeParse({ version: 1, definitions: [], pages: [{ ...page, quirks }] }).success).toBe(
      false,
    )
})

it('keeps a closed new-page default with no page identity or executable attributes', () => {
  const defaults = { html: { lang: 'en' }, body: { class: 'original' }, header: true, footer: true, quirks: false }
  expect(SiteOriginalLayout.parse({ ...layout, newPages: defaults }).newPages).toEqual(defaults)
  for (const value of [
    { ...defaults, pageId: id },
    { ...defaults, script: 'run()' },
    { ...defaults, body: { onclick: 'run()' } },
    { ...defaults, quirks: 'true' },
    { ...defaults, header: null },
  ])
    expect(SiteOriginalLayout.safeParse({ ...layout, newPages: value }).success).toBe(false)
  const binding = { fileId: id, position: 'body-end', loading: 'normal', pages: [id], newPages: true },
    bundle = { ...EMPTY_SITE_FILE_BUNDLE, files: [id], scripts: [binding] }
  expect(SiteFileBundle.safeParse(bundle).success).toBe(false)
  expect(SiteFileBundle.parse({ ...bundle, original: { ...layout, newPages: defaults } }).scripts[0]!.newPages).toBe(
    true,
  )
  for (const newPages of ['true', 1, {}, null])
    expect(
      SiteFileBundle.safeParse({
        ...bundle,
        scripts: [{ ...binding, newPages }],
        original: { ...layout, newPages: defaults },
      }).success,
    ).toBe(false)
})
