import { describe, expect, it } from 'vitest'
import type { SectionDraft } from '../app/actions/section-definitions.ts'
import { compileDefinitionDraft } from './definition-compiler.ts'
import { newStructuredSection } from './structured-builder.ts'

function draft(overrides: Partial<SectionDraft> = {}): SectionDraft {
  return {
    slug: 'frame-test',
    name: 'Test frame',
    category: 'Frame',
    sourceHtml: '<nav>{{menu}}</nav>',
    sourceCss: '',
    slots: [{ id: 'menu', kind: 'navigation', label: 'Menu' }],
    scope: 'site',
    siteId: 'site',
    changelog: '',
    placement: 'header',
    ...overrides,
  }
}

describe('frame authoring compilation', () => {
  it('accepts a governed menu in repeated scriptless disclosures', () => {
    const report = compileDefinitionDraft(
      draft({ sourceHtml: '<nav>{{menu}}</nav><details><summary>Menu</summary>{{menu}}</details>' }),
    )
    expect(report.blocking).toEqual([])
    expect(report.carriesTrustedCode).toBe(false)
  })

  it.each(['page', undefined] as const)('refuses governed menu fields in page placement %s', placement => {
    expect(compileDefinitionDraft(draft({ placement })).blocking).toContain(
      'Site menu fields belong in an authored header or footer, not a page section.',
    )
  })

  it.each(['header', 'footer'] as const)('refuses active code in a %s even without fields', placement => {
    expect(
      compileDefinitionDraft(draft({ placement, slots: [], sourceHtml: '<script>alert(1)</script>' })).blocking,
    ).toContain('A site header or footer cannot contain custom scripts or trusted code.')
  })

  it('refuses navigation placeholders in HTML attributes', () => {
    expect(
      compileDefinitionDraft(draft({ sourceHtml: '<nav title="{{menu}}">Menu</nav>' })).blocking.length,
    ).toBeGreaterThan(0)
  })

  it.each(['legacy', 'structured'] as const)(
    'validates untrusted placement in %s authoring before preview',
    definitionKind => {
      expect(
        compileDefinitionDraft(
          draft({
            definitionKind,
            structuredDoc: newStructuredSection(),
            placement: 'invalid' as SectionDraft['placement'],
          }),
        ).blocking,
      ).toContain('Choose page section, site header or site footer.')
    },
  )
})

describe('repeat fields in HTML sections', () => {
  const page = (slots: SectionDraft['slots']) =>
    draft({
      placement: 'page',
      slug: 'cards',
      slots,
      sourceHtml: '<section><h2>{{heading}}</h2>{{#cards}}<article><h3>{{title}}</h3></article>{{/cards}}</section>',
    })

  it('accepts a list whose items the template draws (V1 cards, steps, tiers)', () => {
    const report = compileDefinitionDraft(
      page([
        { id: 'heading', kind: 'text', label: 'Heading' },
        {
          id: 'cards',
          kind: 'repeat',
          label: 'Cards',
          constraints: { item: { unit: 'Card', fields: [{ id: 'title', kind: 'text', label: 'Title' }] } },
        },
      ]),
    )
    expect(report.blocking).toEqual([])
  })

  it('refuses a list placeholder with no declared item layout', () => {
    const report = compileDefinitionDraft(
      page([
        { id: 'heading', kind: 'text', label: 'Heading' },
        { id: 'cards', kind: 'repeat', label: 'Cards', constraints: {} },
      ]),
    )
    expect(report.blocking).toContain('Lists need a declared item layout and fields.')
  })
  it('recompiles explicitly declared native list markup for archive transfers without executable code', () => {
    const input = page([
      { id: 'heading', kind: 'text', label: 'Heading' },
      {
        id: 'cards',
        kind: 'repeat',
        label: 'Speakers',
        constraints: {
          collection: true,
          item: { unit: 'Speaker', fields: [{ id: 'title', kind: 'text', label: 'Name' }] },
        },
      },
    ])
    const report = compileDefinitionDraft(input)
    expect(report.blocking).toEqual([])
    expect(report.carriesTrustedCode).toBe(false)
    expect(
      report.ast.nodes
        .filter(node => node.kind === 'slot' && node.slotKind === 'repeat')
        .map(node => (node.kind === 'slot' ? node.marker : undefined)),
    ).toEqual(['start', 'end'])
    for (const placement of ['header', 'footer'] as const)
      expect(compileDefinitionDraft({ ...input, placement }).blocking).toContain(
        'Site frame components cannot contain collection lists. Place the collection in a page section instead.',
      )
    const malformed = structuredClone(input)
    malformed.slots[1]!.constraints = {
      collection: true,
      item: { fields: [{ id: 'nested', kind: 'repeat', label: 'Nested' }] },
    }
    expect(compileDefinitionDraft(malformed).blocking).toContain('Lists need a declared item layout and fields.')
  })
})
