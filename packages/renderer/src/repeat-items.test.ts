import { describe, expect, it } from 'vitest'
import { sourceSampleValues, moveRepeatItem, removeRepeatItem, SOURCE_DRAWINGS, type SlotDef } from '@cms/schema'
import { compileSection, upgradeCompiledSection, type AstNode } from './compile.ts'
import { renderSection } from './render.ts'

// LIB-02: a repeated item's markup is written once and drawn once per item.
const cards: SlotDef = {
  id: 'cards',
  kind: 'repeat',
  label: 'Cards',
  constraints: {
    item: {
      unit: 'Card',
      min: 0,
      max: 6,
      fields: [
        { id: 'title', kind: 'text', label: 'Title' },
        { id: 'photo', kind: 'image', label: 'Photo' },
        { id: 'more', kind: 'link', label: 'Link' },
      ],
      samples: [
        {
          title: 'Compassionate care',
          photo: { src: '/media/a/original', alt: 'A meal' },
          more: { url: '/care', label: 'Read more' },
        },
        { title: 'Safe places' },
      ],
    },
  },
}
const heading: SlotDef = {
  id: 'heading',
  kind: 'text',
  label: 'Heading',
  constraints: { sourceSample: 'Why it works' },
}
const sourceHtml =
  '<section><h2>{{heading}}</h2><div class="grid">{{#cards}}<article class="card"><img src="{{photo}}" alt="{{photo}}">' +
  '<h3>{{title}}</h3>{{more}}</article>{{/cards}}</div></section>'

function section(values: Record<string, unknown>, html = sourceHtml) {
  const compiled = compileSection({ sourceHtml: html, slots: [heading, cards], scopeSelector: '.cms-section--grid' })
  return {
    compiled,
    view: {
      def: { section_def_id: 'd', version: 1, slug: 'grid', compiled_ast: compiled.ast, slots: [heading, cards] },
      instance: { section_def_id: 'd', section_def_version: 1, values },
    } as Parameters<typeof renderSection>[0],
  }
}

describe('repeated items in a section template', () => {
  it('compiles the item markup once, between markers, with the item’s own fields', () => {
    const { compiled } = section({})
    expect(compiled.blocking).toEqual([])
    expect(compiled.problems).toEqual([])
    const slots = compiled.ast.nodes.filter((node): node is Extract<AstNode, { kind: 'slot' }> => node.kind === 'slot')
    expect(slots.map(node => [node.slotId, node.slotKind, node.marker ?? node.context])).toEqual([
      ['heading', 'text', 'element-text'],
      ['cards', 'repeat', 'start'],
      ['photo', 'image', 'url-attribute'],
      ['photo', 'image', 'quoted-attribute'],
      ['title', 'text', 'element-text'],
      ['more', 'link', 'element-text'],
      ['cards', 'repeat', 'end'],
    ])
  })

  it('draws one copy per item in the stored order, and none for an empty list', () => {
    const values = sourceSampleValues([heading, cards])
    const html = renderSection(section(values).view, 0)
    expect(html).toContain(
      '<div class="grid"><article class="card"><img src="/media/a/original" alt="A meal"><h3>Compassionate care</h3><a href="/care">Read more</a></article>' +
        '<article class="card"><img src="" alt=""><h3>Safe places</h3></article></div>',
    )
    const moved = renderSection(section(moveRepeatItem(values, cards, 'i2', -1)).view, 0)
    expect(moved.indexOf('Safe places')).toBeLessThan(moved.indexOf('Compassionate care'))
    const emptied = removeRepeatItem(removeRepeatItem(values, cards, 'i1'), cards, 'i2')
    expect(renderSection(section(emptied).view, 0)).toContain('<div class="grid"></div>')
    expect(renderSection(section(emptied).view, 0, { preview: true })).toContain(
      'This list is empty. Add a card from the panel.',
    )
  })

  it('gives every item field its own id in the editor, pictures included', () => {
    const html = renderSection(section(sourceSampleValues([heading, cards])).view, 0, { preview: true })
    expect(html).toContain(
      '<cms-slot data-cms-slot="cards__i1__title" data-cms-kind="text">Compassionate care</cms-slot>',
    )
    expect(html).toContain('<cms-slot data-cms-slot="cards__i2__title" data-cms-kind="text">Safe places</cms-slot>')
    expect(html).toMatch(/<img data-cms-slot="cards__i1__photo" data-cms-kind="image" src="\/media\/a\/original"/)
    expect(html).not.toContain('data-cms-slot="title"')
  })

  it('refuses markers that would change how the copies are read', () => {
    const blocked = (html: string) => compileSection({ sourceHtml: html, slots: [heading, cards] }).blocking
    expect(blocked('<div title="{{#cards}}">{{title}}{{photo}}{{more}}{{/cards}}</div>')).toEqual(
      expect.arrayContaining([expect.stringMatching(/must sit between tags/)]),
    )
    expect(blocked('<div>{{#cards}}{{title}}{{photo}}{{more}}</div>')).toEqual(
      expect.arrayContaining(['{{#cards}} is never closed']),
    )
    expect(blocked('<div>{{/cards}}</div>')).toEqual(['{{/cards}} closes an item that is not open'])
    expect(blocked('<div>{{#cards}}<p>{{title}}</p>{{photo}}{{more}}{{/cards}}{{#cards}}{{/cards}}</div>')).toContain(
      '{{#cards}} is used more than once',
    )
    const unknown = compileSection({
      sourceHtml: '<div>{{#cards}}<p>{{heading}}{{title}}{{photo}}{{more}}</p>{{/cards}}</div>',
      slots: [heading, cards],
    })
    expect(unknown.problems).toContain("inside {{#cards}}, {{heading}} is not one of the item's fields")
    expect(
      compileSection({ sourceHtml: '<div>{{#heading}}{{/heading}}{{heading}}</div>', slots: [heading] }).problems,
    ).toContain('the template uses {{#heading}} but no repeated field with that id declares its items')
  })

  it('refuses a stored template whose markers were forged or moved', () => {
    const { compiled } = section({})
    const nodes = compiled.ast.nodes
    const forged = (change: (nodes: AstNode[]) => AstNode[]) =>
      upgradeCompiledSection({ ...compiled.ast, nodes: change(structuredClone(nodes)) }).blocking
    expect(forged(list => list)).toEqual([])
    expect(
      forged(list =>
        list.map(node =>
          node.kind === 'slot' && node.slotId === 'heading' ? { ...node, marker: 'start' as const } : node,
        ),
      ),
    ).toContain('slot heading carries a repeat marker it cannot have')
    expect(forged(list => list.filter(node => !(node.kind === 'slot' && node.marker === 'end')))).toContain(
      'repeat cards is never closed',
    )
    // An opening marker moved into an attribute value is read where it really is.
    expect(
      forged(list =>
        list.map(node =>
          node.kind === 'html' && node.value.endsWith('<div class="grid">')
            ? { kind: 'html' as const, value: node.value.replace('<div class="grid">', '<div class="grid" title="') }
            : node,
        ),
      ),
    ).not.toEqual([])
  })

  it('draws an item’s icon from V1’s own drawings by name, and nothing for any other value', () => {
    const [key, drawing] = Object.entries(SOURCE_DRAWINGS)[0]!
    const icons: SlotDef = {
      id: 'icons',
      kind: 'repeat',
      label: 'Icons',
      constraints: {
        item: {
          unit: 'Icon',
          fields: [{ id: 'icon', kind: 'text', label: 'Icon', constraints: { presentation: 'v1-source-drawings' } }],
        },
      },
    }
    const compiled = compileSection({
      sourceHtml: '<ul>{{#icons}}<li><span aria-hidden="true">{{icon}}</span></li>{{/icons}}</ul>',
      slots: [icons],
    })
    expect(compiled.blocking).toEqual([])
    const view = (values: Record<string, unknown>) =>
      ({
        def: { section_def_id: 'd', version: 1, slug: 'icons', compiled_ast: compiled.ast, slots: [icons] },
        instance: { section_def_id: 'd', section_def_version: 1, values },
      }) as Parameters<typeof renderSection>[0]
    const values = {
      icons: { items: ['i1', 'i2', 'i3'] },
      icons__i1__icon: key,
      icons__i2__icon: '<svg onload="alert(1)"></svg>',
      icons__i3__icon: 'heart',
    }
    expect(renderSection(view(values), 0)).toContain(
      `<ul><li><span aria-hidden="true">${drawing.svg}</span></li><li><span aria-hidden="true"></span></li><li><span aria-hidden="true"></span></li></ul>`,
    )
    expect(renderSection(view(values), 0, { preview: true })).toContain(
      `<cms-slot data-cms-slot="icons__i1__icon" data-cms-kind="icon">${drawing.svg}</cms-slot>`,
    )
  })
})
