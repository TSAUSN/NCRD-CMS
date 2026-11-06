import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderSection } from '@cms/renderer'
import { addRepeatItem, repeatItemSpec, SOURCE_DRAWINGS, sourceSampleValues, type SlotDef } from '@cms/schema'
import { catalogueLibraryFor, librarySlug, mapFaithfully, mapLibrarySection } from './catalogue-library.ts'
import { adaptRepeats } from './library-repeats.ts'
import { decideV1Source, probeV1Root } from './parity.ts'
import { classesInStylesheet } from './presets.ts'
import { readV1Catalogue } from './source.ts'

// LIB-02: V1's numbered copies as a list an editor can grow and reorder.
const [heart, home] = Object.entries(SOURCE_DRAWINGS).slice(0, 2)
const card = (n: number, icon: string, title: string) => `
    <article class="grid__card"><span class="grid__icon" data-block-id="feature-${n}-icon" data-editable="icon" aria-hidden="true">${icon}</span>
      <h3 class="grid__title" data-block-id="feature-${n}-title" data-editable="text">${title}</h3></article>`
const html = `<section class="grid"><h2 data-block-id="features-title" data-editable="text">Why it works</h2><div class="grid__cards">${card(
  1,
  heart![1].svg,
  'Compassionate care',
)}${card(2, home![1].svg, 'Safe places')}${card(3, heart![1].svg, 'Local roots')}
  </div></section>`
const labels = new Map([
  ['features-title', 'Heading'],
  ...[1, 2, 3].flatMap(
    n =>
      [
        [`feature-${n}-icon`, `Card ${n} Icon`],
        [`feature-${n}-title`, `Card ${n} Title`],
      ] as [string, string][],
  ),
])
const slug = librarySlug('echelonsymposium', 'feature-grid-v1')
const css = '.grid__cards{display:grid;grid-template-columns:repeat(3,1fr)}'

function render(slots: SlotDef[], compiled: { ast: unknown }, values: Record<string, unknown>) {
  return renderSection(
    {
      def: { section_def_id: slug, version: 1, slug, compiled_ast: compiled.ast, slots },
      instance: { section_def_id: slug, section_def_version: 1, values },
    } as Parameters<typeof renderSection>[0],
    0,
  )
}

describe('numbered copies as a list', () => {
  it('turns identical copies into one item template with V1’s words, drawings and field names as starting items', () => {
    const mapped = mapLibrarySection('feature-grid-v1', slug, html, css, labels)
    if (mapped.disposition !== 'fields') throw new Error(mapped.reason ?? 'static')
    const list = mapped.slots.find(slot => slot.kind === 'repeat')!
    expect(list).toMatchObject({ id: 'feature', label: 'Cards' })
    const spec = repeatItemSpec(list)!
    expect(spec).toMatchObject({ unit: 'Card', min: 1, max: 12 })
    expect(
      spec.fields.map(field => [field.id, field.kind, field.label, field.constraints['presentation'] ?? null]),
    ).toEqual([
      ['icon', 'text', 'Icon', 'v1-source-drawings'],
      ['title', 'text', 'Title', null],
    ])
    expect(spec.samples).toEqual([
      { icon: heart![0], title: 'Compassionate care' },
      { icon: home![0], title: 'Safe places' },
      { icon: heart![0], title: 'Local roots' },
    ])
    expect(mapped.mapped.sourceHtml).toMatch(
      /\{\{#feature\}\}<article class="grid__card"><span class="grid__icon" data-editable="icon" aria-hidden="true">\{\{icon\}\}<\/span>/,
    )
    expect(mapped.mapped.sourceHtml).not.toContain('feature-2-title')
    // Each item draws its own V1 drawing, exactly; a fourth card starts from the last one.
    const values = sourceSampleValues(mapped.slots)
    const once = render(mapped.slots, mapped.mapped.compiled, values)
    expect(once).toContain(
      `${home![1].svg}</span>\n      <h3 class="grid__title" data-editable="text">Safe places</h3>`,
    )
    const grown = render(mapped.slots, mapped.mapped.compiled, addRepeatItem(values, list).values)
    expect(grown.match(/<article class="grid__card">/g)).toHaveLength(4)
    // The numbered fields each starting item replaces, for pages already using the numbered version.
    const numbered = mapFaithfully(slug, html, css, labels)
    if (numbered.disposition !== 'fields') throw new Error('numbered')
    const titles = numbered.slots.filter(slot => /^Card \d Title$/.test(slot.label)).map(slot => slot.id)
    expect((list.constraints['item'] as { from: unknown }).from).toEqual(titles.map(id => ({ title: id })))
  })

  it('stays numbered when the copies differ in their own markup, and says why', () => {
    const open = html.replace('<article class="grid__card">', '<article class="grid__card" data-open="">')
    const reasons: string[] = []
    const numbered = mapFaithfully(slug, open, css, labels)
    if (numbered.disposition !== 'fields') throw new Error('numbered')
    expect(
      adaptRepeats({
        slug,
        html: open,
        css,
        labels,
        numbered: { sourceHtml: numbered.mapped.sourceHtml, slots: numbered.slots },
        explain: reason => reasons.push(reason),
      }),
    ).toBeNull()
    expect(
      mapLibrarySection('feature-grid-v1', slug, open, css, labels).slots!.some(slot => slot.kind === 'repeat'),
    ).toBe(false)
    expect(reasons).toEqual(['the list does not render back to the source'])
  })
})

const source = decideV1Source(process.env.V1_ROOT, probeV1Root)
const withSource = source.kind === 'run' ? describe : describe.skip
withSource('V1’s real library as lists', () => {
  it('offers most numbered sections as lists that render back to V1, and keeps the rest numbered', () => {
    if (source.kind !== 'run') return
    const real = readV1Catalogue(
      { v1Root: source.v1Root, repoRoot: path.resolve(import.meta.dirname, '../../..') },
      classesInStylesheet,
    )
    for (const [site, repo, lists, numbered] of [
      [
        'humanneedsindex',
        'tsa-humanneedsindex',
        38,
        [
          'breadcrumb-v1',
          'event-pricing-v1',
          'event-schedule-v1',
          'faq-accordion-v1',
          'hni-explore-resources-v1',
          'hni-home-explore-v1',
          'story-grid-v1',
          'tabs-v1',
          'testimonial-cards-v1',
        ],
      ],
      [
        'echelonsymposium',
        'tsa-echelonsymposium',
        42,
        [
          'breadcrumb-v1',
          'event-pricing-v1',
          'event-schedule-v1',
          'faq-accordion-v1',
          'pricing-tiers-v1',
          'sponsors-tiered-v1',
          'story-grid-v1',
          'tabs-v1',
          'testimonial-cards-v1',
        ],
      ],
    ] as const) {
      const entries = catalogueLibraryFor(
        real,
        site,
        readFileSync(path.join(source.v1Root, repo, 'src', 'style.css'), 'utf8'),
      )
      const withLists: string[] = [],
        without: string[] = []
      for (const entry of entries) {
        if (entry.disposition !== 'fields') continue
        const mapped = mapLibrarySection(
          entry.sourceId,
          librarySlug(site, entry.sourceId),
          entry.html,
          entry.css,
          entry.labels,
        )
        ;(mapped.slots?.some(slot => slot.kind === 'repeat') ? withLists : without).push(entry.sourceId)
      }
      expect({ site, lists: withLists.length }).toEqual({ site, lists })
      expect(without.filter(id => (numbered as readonly string[]).includes(id)).sort()).toEqual([...numbered].sort())
    }
  })
})
