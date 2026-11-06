import { describe, expect, it } from 'vitest'
import { digest, type V1Backup } from './backup.ts'
import { readSiteVariants } from './site-variants.ts'
import { referencePages } from './reference-pages.ts'
import type { V1Catalogue, V1Definition } from './source.ts'
const base: V1Definition = {
  id: 'sample-v1',
  name: 'Sample',
  category: 'Content',
  family: 'sample',
  sites: null,
  slots: [],
  html: '<section>Canonical copy must not leak</section>',
  css: '',
  sourcePath: 'generated.js',
  sourceLine: 1,
  htmlSha256: 'a'.repeat(64),
  cssSha256: digest(''),
}
const sites = ['humanneedsindex', 'echelonsymposium']
const html = (site: string) => `<section class="sample"><p>${site} original</p></section>`
const rows = [
  { id: base.id, sites, hashes: Object.fromEntries(sites.map(site => [site, digest(html(site)).slice(0, 16)])) },
]
const moduleFor = (site: string) =>
  `const template = ${JSON.stringify({ ...base, html: html(site), css: '.sample{padding:1rem}' })}; export const gitSectionTemplates = [template]`
const files = new Map(
  sites.flatMap(site => [
    [`tsa-${site}/src/cms/section-templates.js`, moduleFor(site)],
    [
      `tsa-${site}/src/cms/library-sections.js`,
      `export const librarySectionTemplates = [${JSON.stringify({ id: 'unrelated', html: '', css: '', slots: [] })}]`,
    ],
  ]),
)
const read = (path: string) => {
  if (!files.has(path)) throw new Error('missing source')
  return files.get(path)!
}

describe('separate source-site declarations', () => {
  it('preserves exact source HTML, CSS, site and per-object provenance', () => {
    const variants = readSiteVariants(rows, [base], read)
    expect(variants.map(variant => variant.sourceSite)).toEqual(['echelonsymposium', 'humanneedsindex'])
    for (const variant of variants) {
      expect(variant.html).toBe(html(variant.sourceSite))
      expect(variant.sourcePath).toBe(`tsa-${variant.sourceSite}/src/cms/section-templates.js`)
      expect(variant.htmlSha256).toBe(digest(variant.html))
      expect(variant.cssSha256).toBe(digest('.sample{padding:1rem}'))
      expect(variant.sites).toEqual([variant.sourceSite])
    }
  })
  it('refuses changed source bytes until the census is explicitly reviewed', () => {
    expect(() =>
      readSiteVariants(rows, [base], path => read(path).replace('humanneedsindex original', 'changed original')),
    ).toThrow(/hash mismatch/)
  })
  it('refuses missing source templates and unknown source-site identities', () => {
    expect(() => readSiteVariants(rows, [base], path => read(path).replaceAll('sample-v1', 'other-v1'))).toThrow(
      /missing source site template/,
    )
    expect(() => readSiteVariants([{ ...rows[0]!, sites: ['foreign'] }], [base], read)).toThrow(
      /invalid site-variant identity/,
    )
  })
  it('refuses duplicate declarations between module files', () => {
    expect(() =>
      readSiteVariants(rows, [base], path =>
        moduleFor(path.includes('humanneedsindex') ? 'humanneedsindex' : 'echelonsymposium'),
      ),
    ).toThrow(/duplicate site template/)
  })
  it('rejects source mutation after a valid declaration instead of selecting a stale prefix', () => {
    expect(() => readSiteVariants(rows, [base], path => `${read(path)}; template.html = "different"`)).toThrow(
      /expected const/,
    )
  })
})

describe('destination-specific reference-page assembly', () => {
  const catalogue: V1Catalogue = {
    definitions: [base],
    siteVariants: readSiteVariants(rows, [base], read),
    manifest: { files: [], sha256: '' },
    runId: '',
    presetClasses: [],
    presetCss: '',
    divergingIds: [base.id],
    unresolvedAnchors: new Map(),
  }
  const backup: V1Backup = {
    format: 'v1-backup-firestore-json',
    takenAt: '2026-01-01T00:00:00Z',
    files: [],
    documents: 2,
    placeholders: 0,
    records: sites.map(site => ({
      path: `sites/${site}/pages/home`,
      sha256: digest(site),
      payload: { sections: [{ templateId: base.id, content: {} }] },
    })),
  }
  it('keeps different sites independent and records exact selected source receipts', () => {
    const pages = referencePages(backup, catalogue, new Map())
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      const section = page.sections[0]!
      expect(section.sourceHtml).toContain(`${page.sourceSite} original`)
      expect(section.sourceHtml).not.toContain('Canonical copy')
      expect(section.sourceVariant).toMatchObject({
        sourceSite: page.sourceSite,
        templateId: base.id,
        htmlSha256: digest(html(page.sourceSite)),
      })
      expect(section.issues).not.toContain('site-divergence-review')
    }
  })
  it('refuses an unavailable destination variant instead of using another site or canonical content', () => {
    const pages = referencePages(
      backup,
      {
        ...catalogue,
        siteVariants: catalogue.siteVariants.filter(variant => variant.sourceSite === 'humanneedsindex'),
      },
      new Map(),
    )
    expect(pages.find(page => page.sourceSite === 'echelonsymposium')!.sections[0]).toMatchObject({
      status: 'refused',
      issues: ['missing-source-template'],
    })
  })
})
