import { describe, expect, it } from 'vitest'
import { renderSection, sanitizeRichText } from '@cms/renderer'
import { cohesiveRichText } from './cohesive-richtext.ts'
import { editableReference } from './editable-reference.ts'
import { parseHtml } from './html.ts'
import { cohesiveCopy, boundedCopy } from './fixtures/cohesive-copy.ts'

function mapping(html: string, css = '') {
  const result = editableReference({ slug: 'cohesive-source', html, css })
  return {
    ...result,
    render: (values = result.values) =>
      renderSection(
        {
          def: {
            section_def_id: 'cohesive-source',
            version: 1,
            compiled_ast: result.compiled.ast,
            slots: result.slots,
          },
          instance: { section_def_id: 'cohesive-source', section_def_version: 1, values },
        },
        0,
      )
        .replace(/^<div[^>]*>/, '')
        .replace(/<\/div>$/, ''),
  }
}

function candidate(html: string) {
  const parsed = parseHtml(html)
  if (!parsed.ok) throw new Error(parsed.refusal)
  return cohesiveRichText(parsed.nodes)
}

describe('source-preserving cohesive rich text', () => {
  it('maps synthetic multi-paragraph copy with formatting, links and lists as one field', () => {
    const result = mapping(cohesiveCopy.html, cohesiveCopy.css)
    expect(result.slots.map(slot => [slot.kind, slot.label])).toEqual([
      ['text', 'Heading'],
      ['richtext', 'Support & resources'],
    ])
    expect(result.render()).toBe(cohesiveCopy.html.replace(/(<a href="[^"]*")>/g, '$1 rel="noopener nofollow">'))
    expect(result.compiled.css).toContain('.cms-section--cohesive-source .source-copy')
    expect(result.compiled.blocking).toEqual([])
    expect(result.compiled.carriesTrustedCode).toBe(false)
    expect(result.issues).toEqual(['richtext-link-policy-applied'])
  })

  it.each(['text', 'richtext'])('groups a block-shaped %s region without changing its outer styling', editable => {
    const html = `<div class="source-copy" style="color:#123456" data-editable="${editable}" data-cms-label="Source copy"><p>One <strong>complete sentence</strong>.</p>\n<p>And <em>another</em>.</p></div>`
    const result = mapping(html)
    expect(result.slots).toHaveLength(1)
    expect(result.slots[0]).toMatchObject({ kind: 'richtext', label: 'Source copy' })
    expect(result.render()).toBe(html)
  })

  it('retains boundaries and labels around nested fields while grouping each compatible block run', () => {
    const result = mapping(boundedCopy.html, boundedCopy.css)
    expect(result.slots.filter(slot => slot.kind === 'richtext' && slot.constraints['inline'] !== true)).toHaveLength(2)
    // The note's words and bold phrase are one inline field inside its own paragraph.
    expect(result.slots.filter(slot => slot.label.startsWith('Eligibility note'))).toEqual([
      expect.objectContaining({ kind: 'richtext', label: 'Eligibility note', constraints: { inline: true } }),
    ])
    const link = result.slots.find(slot => slot.label === 'Registration · destination')!
    const image = result.slots.find(slot => slot.label === 'Team photo')!
    expect(link.kind).toBe('link')
    expect(image.kind).toBe('image')
    const rendered = result.render({
      ...result.values,
      [link.id]: { url: '/register?session=1&day=2#form' },
      [image.id]: { src: '/new-team.png', alt: 'New community team' },
    })
    expect(rendered).toContain(
      '<aside class="notice" aria-label="Eligibility"><p>Eligibility <em>varies by location</em>.</p><p>Ask us for details.</p></aside>',
    )
    expect(rendered).toContain(
      'class="cta" target="_blank" rel="noopener noreferrer" href="/register?session=1&amp;day=2#form"',
    )
    expect(rendered).toContain('class="cover" src="/new-team.png" alt="New community team"')
  })

  it('joins uniformly styled paragraphs and lists into one field whose definition keeps their presentation', () => {
    const html =
      '<div class="copy" data-editable="richtext" data-cms-label="Story"><p class="lead" style="font-family: var(--font-secondary);">First <strong>part</strong>.</p>\n' +
      '<p class="lead" style="font-family: var(--font-secondary);">Second part.</p><ul class="ticks"><li class="tick">One</li><li class="tick">Two</li></ul></div>'
    const result = mapping(html)
    expect(result.slots).toHaveLength(1)
    expect(result.slots[0]).toMatchObject({
      kind: 'richtext',
      label: 'Story',
      constraints: {
        blockAttributes: {
          p: { class: 'lead', style: 'font-family: var(--font-secondary);' },
          ul: { class: 'ticks' },
          li: { class: 'tick' },
        },
      },
    })
    expect(result.render()).toBe(html)
    expect(result.render({ [result.slots[0]!.id]: '<p>Only one now.</p><ul><li>New</li></ul>' })).toBe(
      '<div class="copy" data-editable="richtext" data-cms-label="Story">' +
        '<p class="lead" style="font-family: var(--font-secondary);">Only one now.</p><ul class="ticks"><li class="tick">New</li></ul></div>',
    )
  })

  it.each([
    ['paragraphs styled differently', '<p class="lead">One.</p><p class="small">Two.</p>'],
    [
      'a style outside the block policy',
      '<p style="background:url(/x.png)">One.</p><p style="background:url(/x.png)">Two.</p>',
    ],
    ['another attribute beside the presentation', '<p class="lead" id="a">One.</p><p class="lead" id="b">Two.</p>'],
  ])('keeps the source markup when %s', (_name, inner) => {
    const result = mapping(`<div data-editable="richtext" data-cms-label="Copy">${inner}</div>`)
    expect(result.slots.some(slot => slot.kind === 'richtext')).toBe(false)
    expect(result.render()).toBe(`<div data-editable="richtext" data-cms-label="Copy">${inner}</div>`)
  })

  it('keeps a styled heading or eyebrow its own field, and one styled plain paragraph a text field', () => {
    const result = mapping(
      '<div data-editable="richtext" data-cms-label="Card"><p class="eyebrow">Nationwide</p><h3 class="title">National perspective</h3><div class="spacer"></div><p class="lead">A single plain paragraph.</p></div>',
    )
    expect(result.slots.map(slot => slot.kind)).toEqual(['text', 'text', 'text'])
    const emphasised = mapping(
      '<div data-editable="richtext" data-cms-label="Note"><p class="lead">One paragraph with <em>emphasis</em> and <a href="/more">a link</a>.</p></div>',
    )
    expect(emphasised.slots).toHaveLength(1)
    expect(emphasised.slots[0]).toMatchObject({
      kind: 'richtext',
      constraints: { blockAttributes: { p: { class: 'lead' } } },
    })
  })

  it('keeps direct nested authoring boundaries out of the parent rich-text value', () => {
    const result = mapping(
      '<div data-editable="richtext" data-cms-label="Overview"><p>Before <em>the note</em>.</p><div data-editable="richtext" data-cms-label="Independent note"><p>My <strong>note</strong>.</p></div><p>After <strong>the note</strong>.</p></div>',
    )
    expect(result.slots.map(slot => slot.label)).toEqual([
      'Overview · paragraph 1',
      'Independent note',
      'Overview · paragraph 2',
    ])
    const note = result.slots[1]!
    expect(result.render({ ...result.values, [note.id]: '<p>Revised <em>independent note</em>.</p>' })).toContain(
      '<div data-editable="richtext" data-cms-label="Independent note"><p>Revised <em>independent note</em>.</p></div>',
    )
  })

  it.each(['class="emphasis"', 'style="color:red"'])(
    'keeps a styled mark %s in the field’s definition, so the paragraph stays one field',
    attr => {
      const html = `<div data-editable="richtext"><p>One <strong ${attr}>important</strong> note.</p></div>`
      const result = mapping(html)
      expect(result.slots).toHaveLength(1)
      expect(result.slots[0]).toMatchObject({
        kind: 'richtext',
        constraints: {
          inlineAttributes: { strong: attr.startsWith('class') ? { class: 'emphasis' } : { style: 'color:red' } },
        },
      })
      expect(result.values[result.slots[0]!.id]).toBe('<p>One <strong>important</strong> note.</p>')
      expect(result.render()).toBe(html)
    },
  )

  it.each(['id="note"', 'aria-label="Important"', 'lang="fr"', 'title="Details"'])(
    'retains authored inline attributes %s instead of dropping them for cohesion',
    attr => {
      const html = `<div data-editable="richtext"><p>One <strong ${attr}>important</strong> note.</p></div>`
      const result = mapping(html)
      expect(result.slots.every(slot => slot.kind === 'text')).toBe(true)
      expect(result.render()).toBe(html)
    },
  )

  it('splits rather than joins when the same mark carries different styles', () => {
    const html = '<p data-editable="text">One <em class="red">a</em> and <em class="blue">b</em>.</p>'
    const result = mapping(html)
    expect(result.slots.every(slot => slot.kind === 'text')).toBe(true)
    expect(result.render()).toBe(html)
  })

  it.each([
    'target="_blank"',
    'rel="noopener noreferrer"',
    'download="guide.pdf"',
    'class="resource"',
    'title="Guide"',
    'data-cms-label="Read the guide"',
  ])('keeps anchor behavior or author labels %s in static markup and exposes its destination', attr => {
    const html = `<div data-editable="richtext"><p>Read <a href="/guide?a=1&amp;b=2#notes" ${attr}>our <strong>guide</strong></a>.</p></div>`
    const result = mapping(html)
    expect(result.slots.some(slot => slot.kind === 'link')).toBe(true)
    expect(result.render()).toBe(html)
  })

  it('respects an untyped nested source label instead of inheriting the parent label', () => {
    const result = mapping(
      '<div data-editable="richtext" data-cms-label="Overview"><p data-cms-label="Fine &amp; print">Useful <strong>details</strong>.</p></div>',
    )
    expect(result.slots.map(slot => slot.label)).toEqual([
      'Fine & print · part 1',
      'Fine & print · bold text',
      'Fine & print · part 2',
    ])
  })

  it.each(['h1', 'h2', 'p', 'span'])('makes an inline-only %s region one inline field, never a block editor', tag => {
    for (const editable of ['text', 'richtext']) {
      const html = `<${tag} data-editable="${editable}">One <strong>whole</strong><br>sentence.</${tag}>`
      const result = mapping(html)
      expect(result.slots).toEqual([expect.objectContaining({ kind: 'richtext', constraints: { inline: true } })])
      expect(result.values[result.slots[0]!.id]).toBe('One <strong>whole</strong><br>sentence.')
      expect(result.issues).not.toContain('inline-richtext-field-mapping-required')
      expect(result.render()).toBe(html)
      // An edit that pastes paragraphs cannot nest a block in the page's element.
      expect(result.render({ ...result.values, [result.slots[0]!.id]: '<p>One</p><p>Two</p>' })).toBe(
        `<${tag} data-editable="${editable}">One<br>Two</${tag}>`,
      )
    }
  })

  it('keeps a text region inside a link as separate text fields, and reports an authored rich-text one', () => {
    expect(
      mapping('<a data-editable="text">One <strong>whole</strong> sentence.</a>').slots.map(slot => slot.kind),
    ).toEqual(['text', 'text', 'text'])
    const result = mapping('<a data-editable="richtext">One <strong>whole</strong> sentence.</a>')
    expect(result.slots.map(slot => slot.kind)).toEqual(['text', 'text', 'text'])
    expect(result.issues).toContain('inline-richtext-field-mapping-required')
  })

  it.each(['', ' data-editable="link"'])(
    'does not insert a link-capable editor inside a surrounding anchor%s',
    editable => {
      const html = `<a href="/whole-card"${editable}><div data-editable="richtext"><p>First <strong>paragraph</strong>.</p><p>Second paragraph.</p></div></a>`
      const result = mapping(html)
      expect(result.slots.some(slot => slot.kind === 'richtext')).toBe(false)
      expect(result.issues).toContain('inline-richtext-field-mapping-required')
      expect(result.render()).toBe(html)
      const firstText = result.slots.find(slot => slot.kind === 'text')!
      expect(result.render({ ...result.values, [firstText.id]: '<a href="/nested">New</a>' })).toContain(
        '&lt;a href="/nested"&gt;New&lt;/a&gt;<strong>paragraph</strong>',
      )
    },
  )

  it('keeps responsive picture ownership through a nested text boundary', () => {
    const html =
      '<div data-editable="richtext"><p>Introductory <em>copy</em>.</p><picture><source srcset="/wide.webp" media="(min-width:800px)"><img data-editable="image" src="/fallback.webp" alt="Team"></picture><p>More copy.</p></div>'
    const result = mapping(html)
    expect(result.slots.map(slot => slot.kind)).toEqual(['richtext', 'richtext'])
    expect(result.issues).toEqual(['responsive-image-field-mapping-required'])
    expect(result.render()).toBe(html)
  })

  it('does not bypass source fidelity checks for an already-sanitized destinationless anchor', () => {
    const html = '<div data-editable="richtext"><p>Read <a rel="noopener nofollow">the placeholder</a>.</p></div>'
    expect(sanitizeRichText(html.replace(/^<div[^>]*>|<\/div>$/g, ''))).toBe(
      '<p>Read <a rel="noopener nofollow">the placeholder</a>.</p>',
    )
    const result = mapping(html)
    expect(result.slots.map(slot => slot.kind)).toEqual(['text', 'text', 'text'])
    expect(result.render()).toBe(html)
  })

  it('keeps cohesive copy around source comments instead of storing an undefined field', () => {
    const html =
      '<div data-editable="richtext"><p>Before <!-- editorial note -->the note.</p>\n<!-- paragraph separator -->\n<p>After.</p></div>'
    const result = mapping(html)
    expect(result.slots.map(slot => slot.kind)).toEqual(['richtext'])
    expect(result.values[result.slots[0]!.id]).toBe('<p>Before the note.</p>\n\n<p>After.</p>')
    expect(result.render()).toBe('<div data-editable="richtext"><p>Before the note.</p>\n\n<p>After.</p></div>')
  })

  it('does not invent a character reference by joining text across a removed comment', () => {
    const html = '<div data-editable="richtext"><p>&am<!-- intentional boundary -->p; literal spelling</p></div>'
    const result = mapping(html)
    expect(result.slots.every(slot => slot.kind === 'text')).toBe(true)
    expect(result.render()).toBe('<div data-editable="richtext"><p>&amp;amp; literal spelling</p></div>')
  })

  it('does not infer editable content outside the source authoring region', () => {
    const html = '<div><p>Static <strong>source</strong> text.</p><a href="/help">Static link</a></div>'
    const result = mapping(html)
    expect(result.slots).toEqual([])
    expect(result.render()).toBe(html)
  })

  it('preserves decoded content and destinations through repeated rich-text edits', () => {
    const result = mapping(
      '<div data-editable="richtext" data-cms-label="Terms &amp; help"><p>&copy; &quot;Community&quot; &amp; support&nbsp;<a href="/search?q=food&amp;city=north#help">Help &amp; advice</a></p></div>',
    )
    const slot = result.slots[0]!
    expect(result.slots).toHaveLength(1)
    let value = result.values[slot.id] as string
    for (let pass = 0; pass < 5; pass += 1) value = sanitizeRichText(value)
    expect(value).toBe(result.values[slot.id])
    expect(value).toContain('© "Community" &amp; support\u00a0')
    expect(value).toContain('href="/search?q=food&amp;city=north#help"')
  })

  it('keeps meaningful nonbreaking whitespace between blocks instead of silently consuming it', () => {
    const html = '<div data-editable="richtext"><p>First.</p>&nbsp;<p>Second.</p></div>'
    const result = mapping(html)
    // It remains outside each rich-text field, rather than becoming a new
    // paragraph when the visual editor opens one of them.
    expect(result.sourceHtml).toContain('}}&nbsp;{{')
    expect(result.render()).toBe(html)
  })

  it('escapes hostile edits and applies the existing link policy without allowing executable markup', () => {
    const result = mapping(cohesiveCopy.html)
    const slot = result.slots.find(slot => slot.kind === 'richtext')!
    const output = result.render({
      ...result.values,
      [slot.id]:
        '<p onclick="alert(1)">Changed <strong>copy</strong><img src=x onerror=alert(1)><a href="java&#x73;cript:alert(1)">bad</a><script>alert(1)</script></p>',
    })
    expect(output).toContain('<p>Changed <strong>copy</strong><a href="#" rel="noopener nofollow">bad</a>alert(1)</p>')
    expect(output).not.toMatch(/<script|onclick|onerror|<img|href="javascript:/)
  })

  it.each([
    '<script>alert(1)</script>',
    '<p onclick="alert(1)">Bad</p>',
    '<iframe src="https://example.test"></iframe>',
  ])('refuses active source %s before field mapping', active => {
    expect(() => mapping(`<div data-editable="richtext">${active}</div>`)).toThrow(/validated passive source/)
  })

  it('produces deterministic IDs and values and does not mutate the supplied fixture', () => {
    const before = JSON.stringify(cohesiveCopy)
    const first = editableReference({ slug: 'same-source', ...cohesiveCopy })
    const second = editableReference({ slug: 'same-source', ...cohesiveCopy })
    expect(second).toEqual(first)
    expect(JSON.stringify(cohesiveCopy)).toBe(before)
  })
})

describe('the semantic sanitizer comparison', () => {
  it('accepts only the additive default link relationship and reports it', () => {
    expect(candidate('<p><a href="/guide">Guide</a></p>')).toEqual({
      value: '<p><a href="/guide" rel="noopener nofollow">Guide</a></p>',
      linkPolicyApplied: true,
    })
    expect(candidate('<p><a rel="noopener nofollow" href="/guide">Guide</a></p>')).toEqual({
      value: '<p><a href="/guide" rel="noopener nofollow">Guide</a></p>',
      linkPolicyApplied: false,
    })
    expect(candidate('<p><a href="/guide" rel="help">Guide</a></p>')).toBeNull()
  })

  it.each([
    '<p><a href="javascript:alert(1)">Unsafe</a></p>',
    '<p><a href="java&#x73;cript:alert(1)">Encoded</a></p>',
    '<p><a href=" /guide ">Changed destination spelling</a></p>',
    '<p><a>Anchor without a destination</a></p>',
    '<p><span>Lost wrapper</span></p>',
    '<p data-block-id="nested">Lost source identity</p>',
    '<p data-editable="text">Lost editable field</p>',
    '<p><img src="/photo.png" alt="Lost image"></p>',
    '<p><svg><path d="M0 0"></path></svg>Lost drawing</p>',
  ])('refuses any other source-tree change: %s', source => {
    expect(candidate(source)).toBeNull()
  })
})
