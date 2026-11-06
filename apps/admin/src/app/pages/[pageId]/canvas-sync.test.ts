// The canvas plan, without a canvas (SPEC §6.4).
//
// The end-to-end specs drive this through a running admin and a real iframe,
// which is where it has to be proved. What that cannot reach cheaply is the
// handful of documents nobody would ever type: a value of the wrong shape for
// its field, a definition that declares a slot the page does not use. Those are
// decisions rather than rendering, so they are answered here.
import { describe, expect, it } from 'vitest'
import type { EditorDocument, EditorSection } from '@cms/domain'
import { planCanvasUpdate, withCanvasValue } from './canvas-sync.ts'

const KINDS: Record<string, string> = { heading: 'text', body: 'richtext', more: 'link' }
const kindOf = (_section: EditorSection, slot: string) => KINDS[slot]

function doc(...sections: Partial<EditorSection>[]): EditorDocument {
  return {
    sections: sections.map(section => ({
      section_def_id: 'hero',
      section_def_version: 1,
      values: {},
      ...section,
    })),
    meta: {},
  }
}

describe('what the canvas is told', () => {
  it('re-renders after appearance changes and resets, rather than only patching text', () => {
    const original = doc({ values: { heading: 'Heading' } })
    const changed = doc({ values: { heading: 'Heading' }, appearance: { spacing: 'compact' } })
    expect(planCanvasUpdate(original, changed, kindOf)).toEqual({ patches: [], render: true })
    expect(planCanvasUpdate(changed, original, kindOf)).toEqual({ patches: [], render: true })
  })
  it('patches a text field in place, because its rendered form is its stored value', () => {
    const plan = planCanvasUpdate(doc({ values: { heading: 'Before' } }), doc({ values: { heading: 'After' } }), kindOf)
    expect(plan).toEqual({ patches: [{ section: 0, slot: 'heading', value: 'After' }], render: false })
  })

  it('asks for a render for URL-bearing field types, whatever changed in them', () => {
    for (const [slot, value] of [['more', { label: 'Go', url: '/' }]] as const) {
      const plan = planCanvasUpdate(doc({ values: {} }), doc({ values: { [slot]: value } }), kindOf)
      expect(plan.patches, slot).toEqual([])
      expect(plan.render, slot).toBe(true)
    }
  })

  it('sends rich text to the shared sanitizer/model patch path, including undo and clearing', () => {
    const original = doc({ values: { body: '<p>Before <em>formatting</em>.</p>' } })
    const next = doc({ values: { body: '<h3>After</h3><ul><li><p>Item</p></li></ul>' } })
    expect(planCanvasUpdate(original, next, kindOf)).toEqual({
      patches: [{ section: 0, slot: 'body', kind: 'richtext', value: next.sections[0]!.values.body }],
      render: false,
    })
    expect(planCanvasUpdate(next, original, kindOf).patches[0]?.value).toBe(original.sections[0]!.values.body)
    expect(planCanvasUpdate(next, doc({ values: {} }), kindOf)).toEqual({
      patches: [{ section: 0, slot: 'body', kind: 'richtext', value: '' }],
      render: false,
    })
    expect(planCanvasUpdate(next, doc({ values: { body: {} } }), kindOf)).toEqual({ patches: [], render: true })
  })

  it('says nothing at all when nothing the page shows has changed', () => {
    const plan = planCanvasUpdate(
      doc({ values: { heading: 'Same' }, label: 'Old name' }),
      doc({ values: { heading: 'Same' }, label: 'New name' }),
      kindOf,
    )
    // A section's label names it in the structure tree and appears nowhere on
    // the page, so renaming one is not a reason to reload what somebody is
    // looking at.
    expect(plan).toEqual({ patches: [], render: false })
  })

  it('clears a text field rather than leaving the last thing typed on the page', () => {
    // What a revert produces when the field did not exist when the page loaded:
    // the key is removed, and the renderer shows an empty region for it.
    const plan = planCanvasUpdate(doc({ values: { heading: 'Typed' } }), doc({ values: {} }), kindOf)
    expect(plan).toEqual({ patches: [{ section: 0, slot: 'heading', value: '' }], render: false })
  })

  it('renders rather than patches a text field holding something that is not text', () => {
    // A definition and a page that disagree about a field. The renderer decides
    // what that looks like; guessing here would put something on the canvas
    // that publishing would not produce.
    const plan = planCanvasUpdate(
      doc({ values: { heading: 'Typed' } }),
      doc({ values: { heading: { label: 'Go' } } }),
      kindOf,
    )
    expect(plan.patches).toEqual([])
    expect(plan.render).toBe(true)
  })

  it('renders when a slot belongs to no declared field, since nothing knows what it is', () => {
    const plan = planCanvasUpdate(doc({ values: {} }), doc({ values: { mystery: 'x' } }), kindOf)
    expect(plan.render).toBe(true)
  })

  it('renders when a section is added, removed, re-versioned or hidden somewhere', () => {
    const one = doc({ values: { heading: 'A' } })
    expect(planCanvasUpdate(one, doc({ values: { heading: 'A' } }, {}), kindOf).render).toBe(true)
    expect(planCanvasUpdate(one, doc(), kindOf).render).toBe(true)
    expect(planCanvasUpdate(one, doc({ values: { heading: 'A' }, section_def_version: 2 }), kindOf).render).toBe(true)
    expect(planCanvasUpdate(one, doc({ values: { heading: 'A' }, hidden_at: ['sm'] }), kindOf).render).toBe(true)
    expect(planCanvasUpdate(one, doc({ values: { heading: 'A' }, hidden: true }), kindOf).render).toBe(true)
  })

  it('patches nothing at a position two different definitions now occupy', () => {
    // Reordering renumbers the positions the canvas is addressed by, so the
    // values at this index belong to a different section's fields.
    const plan = planCanvasUpdate(
      doc({ values: { heading: 'Hero' } }, { section_def_id: 'prose', values: { heading: 'Prose' } }),
      doc({ section_def_id: 'prose', values: { heading: 'Prose' } }, { values: { heading: 'Hero' } }),
      kindOf,
    )
    expect(plan.patches).toEqual([])
    expect(plan.render).toBe(true)
  })
})

describe('recording what the canvas already shows', () => {
  it('keeps the value somebody typed on the page from being posted back to them', () => {
    const shown = withCanvasValue(doc({ values: { heading: 'Typed on the page' } }), 0, 'heading', 'Typed on the pag')
    expect(planCanvasUpdate(shown, doc({ values: { heading: 'Typed on the pag' } }), kindOf).patches).toEqual([])
  })

  it('leaves the document it was given alone', () => {
    const before = doc({ values: { heading: 'Original' } })
    withCanvasValue(before, 0, 'heading', 'Changed')
    expect(before.sections[0]!.values['heading']).toBe('Original')
  })

  it('ignores a position that does not exist, rather than inventing one', () => {
    const before = doc({ values: { heading: 'Original' } })
    expect(withCanvasValue(before, 4, 'heading', 'Changed')).toBe(before)
  })
})

it('clears sample markers without interrupting a typed field, while anchors still request canonical markup', () => {
  const before = doc({ values: { heading: 'Sample title', __cms_sample_fields: ['heading'] } }),
    after = doc({ values: { heading: 'Our title' } })
  expect(planCanvasUpdate(before, after, kindOf)).toEqual({
    patches: [{ section: 0, slot: 'heading', value: 'Our title' }],
    render: false,
  })
  expect(
    planCanvasUpdate(after, doc({ values: { heading: 'Our title', __cms_anchor: 'our-story' } }), kindOf).render,
  ).toBe(true)
})

it('refreshes a list when its illustrative-record marker is removed even if the binding is unchanged', () => {
  const binding = { readerKey: 'speakers', selection: { mode: 'automatic', limit: 6 } }
  expect(
    planCanvasUpdate(
      doc({ values: { speakers: binding, __cms_sample_fields: ['speakers'] } }),
      doc({ values: { speakers: binding } }),
      () => 'repeat',
    ).render,
  ).toBe(true)
})

it('renders a changed page identity, including Undo, without changing content', () => {
  const original = { ...doc(), identity: { title: 'Live page', address: 'live' } }
  const next = { ...original, identity: { title: 'Draft page', address: 'draft' } }
  expect(planCanvasUpdate(original, next, kindOf)).toEqual({ patches: [], render: true })
  expect(planCanvasUpdate(next, original, kindOf)).toEqual({ patches: [], render: true })
})
