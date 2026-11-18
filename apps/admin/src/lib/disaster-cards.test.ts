import { describe, expect, it } from 'vitest'
import {
  applyDisasterEdits,
  decodeText,
  disasterItems,
  parseDisasterBody,
  validateCards,
  type CardEdit,
  type DisasterItem,
} from './disaster-cards.ts'

// The markup mirrors the live Zesty field: one block per card, an image either
// from a URL or from a stylesheet class, optional buttons and hidden cards
// kept as HTML comments. The copy is sample text.
const card = (title: string, image: string, buttons: string, padding = 'p-5') =>
  `<div class="row bg-area rounded-3 p-3 mb-3">
<div class="col-md-3 ${image}</div>
<div class="col-md-9 rounded-3 h-100 ${padding}">
<h2>${title}</h2>
<p>[Sample description for ${title}]</p>
${buttons}</div>
</div>`
const both =
  '<a class="btn btn-secondary" href="https://example.org/learn">Learn More</a> <a class="btn btn-primary" href="https://example.org/give?a=1&amp;b=2">Donate</a>'
const SOURCE =
  '<div class="row">\n<div class="col-sm-12">\n' +
  card(
    'Sample Flood (November 2026)',
    `disasterCardImg rounded-3" style="background-image: url('https://abc.media.zestyio.com/flood.webp');">`,
    both,
  ) +
  '\n' +
  card(
    'Sample Storm (August&ndash;September 2026)',
    `disasterCardImg rounded-3" style="background-image: url('https://abc.media.zestyio.com/storm.jpg'); background-size: cover; background-position: center;">`,
    both,
  ) +
  '\n' +
  card(
    'Sample Recovery',
    'helene disasterCardImg rounded-3">',
    '<a class="btn btn-secondary" href="https://example.org/recovery">Learn More</a>',
  ) +
  '\n<!--\n                ' +
  card('Sample Archived Fire', 'fire disasterCardImg rounded-3">', both) +
  '\n                --></div>\n</div>'

const edits = (items: DisasterItem[]): CardEdit[] =>
  items.map(item =>
    item.kind === 'locked'
      ? { key: item.key, kind: 'locked' }
      : {
          key: item.key,
          kind: 'card',
          hidden: item.hidden,
          title: item.title,
          description: item.description,
          imageUrl: item.imageUrl,
          learnMore: item.learnMore,
          donate: item.donate,
        },
  )

describe('reading the Current Disasters field', () => {
  const document = parseDisasterBody(SOURCE)
  const items = disasterItems(document)

  it('finds every card, including hidden ones, with decoded text', () => {
    expect(items.map(item => [item.kind, item.hidden, item.kind === 'card' && item.title])).toEqual([
      ['card', false, 'Sample Flood (November 2026)'],
      ['card', false, 'Sample Storm (August–September 2026)'],
      ['card', false, 'Sample Recovery'],
      ['card', true, 'Sample Archived Fire'],
    ])
    expect(items[0]).toMatchObject({
      imageUrl: 'https://abc.media.zestyio.com/flood.webp',
      donate: { href: 'https://example.org/give?a=1&b=2', label: 'Donate' },
    })
    expect(items[2]).toMatchObject({ imageUrl: null, imageClass: 'helene', donate: null })
  })

  it('writes the field back byte for byte when nothing changed', () => {
    expect(applyDisasterEdits(document, edits(items))).toBe(SOURCE)
  })

  it('rewrites only the card that changed and escapes what was typed', () => {
    const changed = edits(items).map(edit =>
      edit.key === 'block-1' && edit.kind === 'card'
        ? { ...edit, title: 'Storm <script>alert(1)</script> & more' }
        : edit,
    )
    const output = applyDisasterEdits(document, changed)
    expect(output).toContain('<h2>Storm &lt;script&gt;alert(1)&lt;/script&gt; &amp; more</h2>')
    expect(output).not.toContain('<script>')
    // The untouched cards and the surrounding markup are unchanged.
    const storm = SOURCE.indexOf('<h2>Sample Storm')
    const recovery = SOURCE.indexOf('<div class="row bg-area', storm)
    expect(output.startsWith(SOURCE.slice(0, storm))).toBe(true)
    expect(output.endsWith(SOURCE.slice(recovery))).toBe(true)
    // The kept background placement survives the rewrite.
    expect(output).toContain(
      "url('https://abc.media.zestyio.com/storm.jpg'); background-size: cover; background-position: center;",
    )
  })

  it('hides, shows, reorders, removes and adds cards', () => {
    const list = edits(items)
    const added: CardEdit = {
      key: 'new-abc123',
      kind: 'card',
      hidden: false,
      title: 'Sample New Response',
      description: 'Sample "quoted" text',
      imageUrl: 'https://abc.media.zestyio.com/new.webp',
      learnMore: { href: 'https://example.org/new', label: 'Learn More' },
      donate: null,
    }
    const next = [
      added,
      { ...(list[3] as Extract<CardEdit, { kind: 'card' }>), hidden: false },
      { ...(list[0] as Extract<CardEdit, { kind: 'card' }>), hidden: true },
      list[2]!,
    ]
    const reread = disasterItems(parseDisasterBody(applyDisasterEdits(document, next)))
    expect(reread.map(item => [item.kind === 'card' && item.title, item.hidden])).toEqual([
      ['Sample New Response', false],
      ['Sample Archived Fire', false],
      ['Sample Flood (November 2026)', true],
      ['Sample Recovery', false],
    ])
    expect(reread[0]).toMatchObject({ description: 'Sample "quoted" text', donate: null })
    expect(reread[1]).toMatchObject({ imageClass: 'fire', imageUrl: null })
  })

  it('refuses keys the fresh read does not know, so stale or forged edits never reach Zesty', () => {
    expect(() => applyDisasterEdits(document, [...edits(items), { key: 'block-99', kind: 'locked' }])).toThrow()
    const forged = edits(items).map(edit =>
      edit.key === 'block-0' ? { key: 'block-0', kind: 'locked' as const } : edit,
    )
    expect(() => applyDisasterEdits(document, forged)).toThrow()
  })

  it('keeps markup it does not recognise, locked and in place', () => {
    const odd = SOURCE.replace(
      '<p>[Sample description for Sample Recovery]</p>',
      '<p>Text with <strong>bold</strong></p>',
    )
    const oddDocument = parseDisasterBody(odd)
    const oddItems = disasterItems(oddDocument)
    expect(oddItems[2]).toMatchObject({ kind: 'locked' })
    expect(applyDisasterEdits(oddDocument, edits(oddItems))).toBe(odd)
    expect(() =>
      applyDisasterEdits(
        oddDocument,
        edits(oddItems).filter(edit => edit.kind !== 'locked'),
      ),
    ).toThrow()
  })
})

describe('checking edits', () => {
  it('requires text and https links', () => {
    const problems = validateCards([
      {
        key: 'new-1',
        kind: 'card',
        hidden: false,
        title: ' ',
        description: 'x',
        imageUrl: 'javascript:alert(1)',
        learnMore: { href: 'http://example.org', label: 'Learn More' },
        donate: { href: 'https://example.org/"onmouseover', label: '' },
      },
    ])
    expect(problems.map(problem => problem.field)).toEqual(['title', 'imageUrl', 'learnMore', 'donate', 'donate'])
  })

  it('leaves unknown entities undecoded so their card stays locked', () => {
    expect(decodeText('A &amp; B &ndash; C')).toBe('A & B – C')
    expect(decodeText('A &bogus; B')).toBeNull()
    expect(decodeText('A & B')).toBeNull()
  })
})
