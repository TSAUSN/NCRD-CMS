import { describe, expect, it } from 'vitest'
import { renderSection } from '@cms/renderer'
import { editableReference } from './editable-reference.ts'

function mapped(html: string) {
  const result = editableReference({ slug: 'editable-reference', html, css: '' })
  const render = (values = result.values) =>
    renderSection(
      {
        def: { section_def_id: 'reference', version: 1, compiled_ast: result.compiled.ast, slots: result.slots },
        instance: { section_def_id: 'reference', section_def_version: 1, values },
      },
      0,
    )
      .replace(/^<div[^>]*>/, '')
      .replace(/<\/div>$/, '')
  return { ...result, render }
}

describe('naming the fields of a region split into several', () => {
  const labels = (html: string) => mapped(html).slots.map(slot => slot.label)

  it('keeps the region name for its own words and names emphasis, paragraphs and headings by what they are', () => {
    // Words with a styled emphasis are one inline field now (see the inline
    // mapping cases); a span that is not a mark still splits its region.
    expect(
      labels(
        '<p data-editable="text" data-block-id="hero-subtitle">Discover more<br><em class="text-sa-red">love beyond hardship</em></p>',
      ),
    ).toEqual(['Hero subtitle'])
    expect(
      labels(
        '<p data-editable="text" data-block-id="hero-subtitle">Discover more <span class="red">love beyond hardship</span></p>',
      ),
    ).toEqual(['Hero subtitle', 'Hero subtitle · text'])
    expect(
      labels(
        '<div data-editable="richtext" data-block-id="measuring-left-body"><p class="mb-5">First.</p><p>Second.</p></div>',
      ),
    ).toEqual(['Measuring left body · paragraph 1', 'Measuring left body · paragraph 2'])
    expect(
      labels(
        '<h2 data-editable="text" data-block-id="approach-h2"><span class="step-number">01</span>Our approach</h2>',
      ),
    ).toEqual(['Approach h2 · text', 'Approach h2'])
  })

  it('counts repeated cards and numbers a role only where it repeats', () => {
    const card = (n: number) =>
      `<div class="card"><span class="value">${n}</span><span class="caption">Caption ${n}</span></div>`
    expect(labels(`<div data-editable="richtext" data-block-id="insights-stats">${card(1)}${card(2)}</div>`)).toEqual([
      'Insights stats · group 1 · text 1',
      'Insights stats · group 1 · text 2',
      'Insights stats · group 2 · text 1',
      'Insights stats · group 2 · text 2',
    ])
    const story = (n: number) =>
      `<article class="card"><p class="eyebrow">Eyebrow ${n}</p><h3 class="title">Title ${n}</h3><div class="prose"><p>Body ${n}</p></div></article>`
    expect(
      labels(`<div data-editable="richtext" data-block-id="insights-body">${story(1)}${story(2)}</div>`).slice(0, 3),
    ).toEqual([
      'Insights body · card 1 · paragraph 1',
      'Insights body · card 1 · heading',
      'Insights body · card 1 · paragraph 2',
    ])
    expect(
      labels(
        '<div data-editable="richtext" data-block-id="map-rail"><p class="label">Years</p><div class="list"><span>2019</span><span>2020</span></div></div>',
      ),
    ).toEqual(['Map items · paragraph', 'Map items · text 1', 'Map items · text 2'])
  })

  it('names an unlabelled link or image inside a region after the region, and leaves field identity alone', () => {
    const source =
      '<div data-editable="richtext" data-block-id="about-sa"><h3 class="title">About</h3><p class="lead">Story <strong class="red">here</strong>.</p><a href="https://example.org/" class="more">Visit</a></div>'
    const result = mapped(source)
    expect(result.slots.map(slot => slot.label)).toEqual([
      'About sa · heading',
      'About sa · paragraph',
      'About sa · link · destination',
      'About sa · link · label',
    ])
    expect(result.render()).toBe(source)
    // Names never feed identities: the ids are the element paths they always were.
    expect(result.slots.every(slot => /^v1-[0-9a-f]{24}$/.test(slot.id))).toBe(true)
  })
})

describe('editable V1 reference mapping', () => {
  it('uses plain inferred names while keeping authored labels and field identity', () => {
    const source = '<p data-editable="text" data-block-id="faq-questions-amp-answers">Questions</p>'
    const inferred = mapped(source)
    const authored = mapped(
      source.replace('data-editable="text"', 'data-editable="text" data-cms-label="Reader questions"'),
    )
    expect(inferred.slots[0]!.label).toBe('FAQ questions and answers')
    expect(authored.slots[0]!.label).toBe('Reader questions')
    expect(authored.slots[0]!.id).toBe(inferred.slots[0]!.id)
  })
  it('retains formatting and decodes text once through subsequent edits', () => {
    const source =
      '<h1 data-editable="text" data-block-id="hero-title" class="hero">Food &amp; shelter<br><em>for everyone</em></h1>'
    const result = mapped(source)
    expect(result.slots).toEqual([
      expect.objectContaining({ kind: 'richtext', label: 'Hero title', constraints: { inline: true } }),
    ])
    expect(result.values[result.slots[0]!.id]).toBe('Food &amp; shelter<br><em>for everyone</em>')
    expect(result.render()).toBe(source)
    const values = { ...result.values, [result.slots[0]!.id]: '<script>bad()</script> & help<br><em>for everyone</em>' }
    expect(result.render(values)).toContain(
      '<h1 data-editable="text" data-block-id="hero-title" class="hero">bad() &amp; help<br><em>for everyone</em></h1>',
    )
  })
  it('retains link classes and embedded icons while safely editing its destination', () => {
    const source =
      '<a data-editable="link" data-block-id="learn" class="cta" href="/learn?a=1&amp;b=2"><svg><path d="M0 0"></path></svg>Learn more</a>'
    const result = mapped(source)
    expect(result.render()).toBe(source)
    const href = result.slots.find(slot => slot.label.endsWith('destination'))!
    expect(result.render({ ...result.values, [href.id]: { url: 'javascript:alert(1)' } })).toContain('href="#"')
    expect(result.render({ ...result.values, [href.id]: { url: '/new' } })).toContain('class="cta" href="/new"')
  })
  it('exposes already canonical rich text to the visual editor', () => {
    const source = '<div data-editable="richtext" data-block-id="story"><p>Help <strong>today</strong>.</p></div>'
    const result = mapped(source)
    expect(result.slots[0]?.kind).toBe('richtext')
    expect(result.render()).toBe(source)
  })
  it('keeps nested link and image fields editable inside an authored text region', () => {
    const source =
      '<p data-editable="text">Read <a data-editable="link" href="/old"><strong>our work</strong></a> <img data-editable="image" src="/photo" alt="Team"></p>'
    const result = mapped(source)
    const link = result.slots.find(slot => slot.kind === 'link')!
    const image = result.slots.find(slot => slot.kind === 'image')!
    expect(link).toBeDefined()
    expect(image).toBeDefined()
    const rendered = result.render({
      ...result.values,
      [link.id]: { url: '/new' },
      [image.id]: { src: '/new-photo', alt: 'New team' },
    })
    expect(rendered).toContain('href="/new"><strong>our work</strong></a>')
    expect(rendered).toContain('src="/new-photo" alt="New team"')
  })
  it('keeps image attributes while exposing a normal image field', () => {
    const result = mapped('<img data-editable="image" src="/media/image/original" alt="Help" class="cover">')
    expect(result.slots[0]?.kind).toBe('image')
    expect(result.issues).toEqual([])
    expect(result.render()).toContain('class="cover"')
    expect(result.render({ [result.slots[0]!.id]: { src: '/replacement', alt: '', decorative: true } })).toContain(
      'src="/replacement" alt="" class="cover" role="presentation"',
    )
  })
  it('keeps a source icon’s own drawing, and offers the closed picker only for an icon named without one', () => {
    // A known name with its own drawing keeps the drawing: the picker would
    // draw a different symbol (SPEC §6.5, LIB-03).
    const drawn = mapped(
      '<span class="round" data-editable="icon" data-icon-name="info"><svg><path d="M0 0"/></svg></span>',
    )
    expect(drawn.slots).toEqual([])
    expect(drawn.issues).toEqual(['icon-source-drawing-kept'])
    expect(drawn.render()).toBe(
      '<span class="round" data-editable="icon" data-icon-name="info"><svg><path d="M0 0"></path></svg></span>',
    )
    // Named but not drawn: the picker's drawing is the only one there is.
    const named = mapped('<span class="round" data-editable="icon" data-icon-name="info"></span>')
    expect(named.slots[0]?.constraints.presentation).toBe('cms-line-icons-v1')
    expect(named.render()).toContain('viewBox="0 0 24 24"')
    expect(named.render({ [named.slots[0]!.id]: 'heart' })).not.toBe(named.render())
    const unknown = mapped('<span data-editable="icon" data-icon-name="custom-mark"><svg><path d="M0 0"/></svg></span>')
    expect(unknown.issues).toContain('icon-field-mapping-required')
    expect(unknown.render()).toContain('d="M0 0"')
  })
  it('refuses active source and authored interpolation', () => {
    expect(() => mapped('<script>alert(1)</script>')).toThrow()
    expect(() => mapped('<p data-editable="text">{{surprise}}</p>')).toThrow()
  })
})
