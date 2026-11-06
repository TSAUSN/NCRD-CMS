import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  catalogueLibraryFor,
  librarySlug,
  mapFaithfully,
  mapLibrarySection,
  siteBrandVariables,
} from './catalogue-library.ts'
import { renderSection } from '@cms/renderer'
import { decideV1Source, probeV1Root } from './parity.ts'
import { classesInStylesheet } from './presets.ts'
import { readV1Catalogue, type V1Catalogue, type V1Definition } from './source.ts'

const SITE_CSS = `@theme { --color-sa-red: #EF3E42; --color-sa-dark: #132230; }
:root { --color-primary: var(--color-sa-red); --sa-dark: var(--color-sa-dark); --font-heading: 'Trajan Pro 3', Georgia, serif; --unused: 1px; }
.theme-teal { --color-primary: #008080; }
@media (max-width: 600px) { :root { --font-heading: system-ui; } }`

describe('a site’s brand values for one library section', () => {
  it('declares on the section exactly the root variables it reads, and the ones their values read', () => {
    expect(siteBrandVariables(SITE_CSS, '.cta{color:var(--color-primary);background:var(--sa-dark, #000)}')).toBe(
      '&{--color-sa-red:#EF3E42;--color-sa-dark:#132230;--color-primary:var(--color-sa-red);--sa-dark:var(--color-sa-dark)}',
    )
    // A class-scoped or media-scoped value is not the site's default.
    expect(siteBrandVariables(SITE_CSS, 'h1{font-family:var(--font-heading)}')).toBe(
      "&{--font-heading:'Trajan Pro 3', Georgia, serif}",
    )
    expect(siteBrandVariables(SITE_CSS, 'p{color:red}')).toBe('')
  })
})

function definition(id: string, html: string, sites: string[] | null = null): V1Definition {
  return {
    id,
    name: id,
    category: 'Content',
    family: null,
    sites,
    slots: [],
    html,
    css: '.x{color:var(--color-primary)}',
    sourcePath: 'registry',
    sourceLine: 1,
    htmlSha256: '',
    cssSha256: '',
  }
}
const catalogue = (definitions: V1Definition[]): V1Catalogue => ({
  definitions,
  siteVariants: [],
  manifest: { files: [], sha256: '' },
  runId: 'run',
  presetClasses: [],
  presetCss: '',
  divergingIds: [],
  unresolvedAnchors: new Map(),
})

describe('what V1 offered one site', () => {
  const library = catalogue([
    definition(
      'hero-v1',
      '<section class="x"><h2 data-editable="text" data-block-id="hero-title">A bold statement</h2></section>',
    ),
    definition('echelon-only-v1', '<section><h2 data-editable="text" data-block-id="t">Event</h2></section>', [
      'echelonsymposium',
    ]),
    definition('divider-v1', '<hr class="x">'),
    definition('signup-v1', '<section><form action="#"><input name="email"></form></section>'),
  ])

  it('offers shared and own sections with the site’s brand, and refuses what it cannot map faithfully', () => {
    const entries = catalogueLibraryFor(library, 'humanneedsindex', SITE_CSS)
    expect(entries.map(entry => [entry.sourceId, entry.disposition])).toEqual([
      ['hero-v1', 'fields'],
      ['divider-v1', 'static'],
      ['signup-v1', 'refused'],
    ])
    expect(entries[0]!.css.startsWith('&{--color-sa-red:#EF3E42;--color-primary:var(--color-sa-red)}')).toBe(true)
    expect(entries[2]!.reason).toMatch(/not passive markup/)
    expect(catalogueLibraryFor(library, 'echelonsymposium').map(entry => entry.sourceId)).toContain('echelon-only-v1')
  })

  it('keeps V1’s words as the section’s starting content, under V1’s own field names', () => {
    const mapped = mapFaithfully(librarySlug('humanneedsindex', 'hero-v1'), library.definitions[0]!.html, '')
    if (mapped.disposition === 'refused') throw new Error(mapped.reason)
    expect(mapped.slots).toEqual([
      expect.objectContaining({ kind: 'text', label: 'Hero title', constraints: { sourceSample: 'A bold statement' } }),
    ])
    const named = mapFaithfully(
      librarySlug('humanneedsindex', 'hero-v1'),
      library.definitions[0]!.html,
      '',
      new Map([['hero-title', 'Title']]),
    )
    if (named.disposition === 'refused') throw new Error(named.reason)
    expect(named.slots.map(slot => [slot.id, slot.label])).toEqual(mapped.slots.map(slot => [slot.id, 'Title']))
  })

  it('refuses a section whose styles the CSS policy would cut', () => {
    const nested = mapFaithfully(
      'v1-lib-hni-x',
      '<section class="x"><h2 data-editable="text" data-block-id="t">T</h2></section>',
      '.x{color:red;.y{color:blue}}',
    )
    expect(nested).toMatchObject({
      disposition: 'refused',
      reason: expect.stringMatching(/would lose rules \(nested rules/),
    })
  })

  it('adapts V1’s embed section to a governed embed field, keeping its title, caption and instructions', () => {
    const html =
      '<section class="v"><h2 data-block-id="embed-title" data-editable="text">Watch</h2><div class="frame">' +
      '<iframe class="v__iframe" data-cms-embed-frame src="" title="Embedded video" hidden></iframe><p class="v__placeholder" data-cms-embed-placeholder>Paste a YouTube or Vimeo link.</p></div>' +
      '<a class="cms-form-action" data-block-id="embed-src" data-editable="link" data-cms-embed-src href="#">Address to embed</a></section>'
    const slug = librarySlug('echelonsymposium', 'video-embed-v1')
    const css =
      '.v{padding:1rem}.frame{position:relative;aspect-ratio:16/9;overflow:hidden}.v__iframe{width:100%;height:100%;border:0}.v__placeholder{position:absolute;inset:0;display:flex}'
    const mapped = mapLibrarySection(
      'video-embed-v1',
      slug,
      html,
      css,
      new Map([
        ['embed-title', 'Section Title'],
        ['embed-src', 'Address to embed'],
      ]),
    )
    if (mapped.disposition === 'refused') throw new Error(mapped.reason)
    expect(mapped.slots.map(slot => [slot.label, slot.kind])).toEqual([
      ['Section Title', 'text'],
      ['Address to embed', 'link'],
    ])
    expect(mapped.slots[1]!.constraints).toEqual({
      destinationOnly: true,
      embed: 'video',
      embedTitle: 'Embedded video',
      embedHelp: 'Paste a YouTube or Vimeo link.',
      embedFrameClass: 'v__iframe',
      embedPlaceholderClass: 'v__placeholder',
    })
    expect(mapped.mapped.sourceHtml).not.toMatch(/iframe|data-cms-embed|cms-library-embed/)
    expect(mapped.mapped.compiled.css).toContain('.v__iframe')
    const render = (url: string, options: Parameters<typeof renderSection>[2] = {}) =>
      renderSection(
        {
          def: { section_def_id: 'd', version: 1, slug, compiled_ast: mapped.mapped.compiled.ast, slots: mapped.slots },
          instance: {
            section_def_id: 'd',
            section_def_version: 1,
            values: { ...mapped.mapped.values, 'v1-embed-src': { url } },
          },
        } as Parameters<typeof renderSection>[0],
        0,
        options,
      )
    // The embed fills V1's frame as V1's iframe did; its notice and hint take V1's placeholder.
    expect(render('https://youtu.be/dQw4w9WgXcQ')).toContain(
      '<div class="frame"><iframe class="v__iframe" data-cms-embed-provider="youtube" title="Embedded video" srcdoc=',
    )
    expect(render('https://evil.example/frame')).toContain('<div class="frame"></div>')
    expect(render('#', { providerEmbeds: false })).toContain(
      '<div class="frame"><p class="v__placeholder">Paste a YouTube or Vimeo link.</p></div>',
    )
    expect(render('https://youtu.be/dQw4w9WgXcQ', { providerEmbeds: false })).toContain(
      '<div class="frame"><p class="v__placeholder"><span><strong>Embedded video</strong><br>YouTube video.',
    )
  })

  it('names each site’s copy so the two sites never share one', () => {
    expect(librarySlug('humanneedsindex', 'hero-v1')).toBe('v1-lib-hni-hero-v1')
    expect(librarySlug('echelonsymposium', 'hero-v1')).toBe('v1-lib-echelon-hero-v1')
  })
})

const source = decideV1Source(process.env.V1_ROOT, probeV1Root)
const withSource = source.kind === 'run' ? describe : describe.skip
withSource('V1’s real library, per site', () => {
  it('maps every section V1 offered each site faithfully, except its forms, charts and footer', () => {
    if (source.kind !== 'run') return
    const real = readV1Catalogue(
      { v1Root: source.v1Root, repoRoot: path.resolve(import.meta.dirname, '../../..') },
      classesInStylesheet,
    )
    const css = (repo: string) => readFileSync(path.join(source.v1Root, repo, 'src', 'style.css'), 'utf8')
    const hni = catalogueLibraryFor(real, 'humanneedsindex', css('tsa-humanneedsindex'))
    const echelon = catalogueLibraryFor(real, 'echelonsymposium', css('tsa-echelonsymposium'))
    const tally = (entries: typeof hni) =>
      entries.reduce<Record<string, number>>(
        (counts, entry) => ({ ...counts, [entry.disposition]: (counts[entry.disposition] ?? 0) + 1 }),
        {},
      )
    expect(tally(hni)).toEqual({ fields: 92, static: 6, refused: 7 })
    expect(tally(echelon)).toEqual({ fields: 86, static: 1, refused: 4 })
    const forms = ['contact-form-v1', 'hero-search-v1', 'locator-form-v1', 'newsletter-signup-v1']
    expect(
      hni
        .filter(entry => entry.disposition === 'refused')
        .map(entry => entry.sourceId)
        .sort(),
    ).toEqual([...forms, 'hni-explore-map-v1', 'hni-explore-timeline-v1', 'hni-footer-v1'].sort())
    expect(
      echelon
        .filter(entry => entry.disposition === 'refused')
        .map(entry => entry.sourceId)
        .sort(),
    ).toEqual([...forms].sort())
    // Echelon's own brand, not HNI's.
    expect(echelon.find(entry => entry.sourceId === 'hero-centered-v1')!.css).toContain('--color-primary:#dd5251')
  })
})
