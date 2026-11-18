// Current Disasters cards: reads and writes the rich-text `body` field of the
// national "Current National and International Disaster Efforts" page in
// Zesty. The field holds one hand-written block per disaster; commented-out
// blocks are cards that are kept on file but not shown.
//
// Only blocks that match the known card markup exactly become editable. Any
// other markup stays in place as a locked block, and a card nobody changed is
// written back byte for byte, so a push never reformats what it did not touch.
//
// The browser never sends markup. It sends plain-text fields and the order of
// item keys; the server re-reads the field from Zesty and takes every original
// block from that fresh read. Text is entity-decoded on read and escaped on
// write, so an edit cannot add markup or script to the live page.

export type DisasterLink = { href: string; label: string }

/** What an editor can change on one card. */
export type CardFields = {
  title: string
  description: string
  /** A background image URL, or null when the image comes from a site stylesheet class. */
  imageUrl: string | null
  learnMore: DisasterLink | null
  donate: DisasterLink | null
}

export type DisasterCard = CardFields & {
  kind: 'card'
  key: string
  hidden: boolean
  /** The extra class on the image column (for example `helene`), kept as read. */
  imageClass: string | null
  /** Extra background placement declarations on the image (for example ` background-size: cover;`), kept as read. */
  imageStyle: string
  /** Padding class on the text column, kept as read. */
  padding: string
}

/** Markup in the card list that is not a recognised card. It is kept as is and cannot be edited. */
export type LockedBlock = { kind: 'locked'; key: string; hidden: boolean; summary: string }

export type DisasterItem = DisasterCard | LockedBlock

type Parsed = {
  item: DisasterItem
  /** The block exactly as stored, including the comment markers of a hidden card. */
  raw: string
}

export type DisasterDocument = {
  /** Markup before the first block, kept exactly. */
  before: string
  /** Markup after the last block, kept exactly. */
  after: string
  blocks: Parsed[]
  /** Text between consecutive blocks, kept when the order does not change. */
  gaps: string[]
  source: string
}

/** One entry of the editor's list, as the browser sends it. */
export type CardEdit = { key: string; kind: 'locked' } | ({ key: string; kind: 'card'; hidden: boolean } & CardFields)

const CARD_OPEN = '<div class="row bg-area rounded-3 p-3 mb-3">'

const CARD =
  /^<div class="row bg-area rounded-3 p-3 mb-3">\s*<div class="col-md-3 (?:([A-Za-z][\w-]*) )?disasterCardImg rounded-3"(?: style="background-image: url\('([^'"]*)'\);((?: background-(?:position|size|repeat): [a-z0-9 %.-]+;)*)")?><\/div>\s*<div class="col-md-9 rounded-3 h-100 (p-5|px-5)">\s*<h2>([^<]*)<\/h2>\s*<p>([^<]*)<\/p>\s*(?:<a class="btn btn-secondary" href="([^"]*)">([^<]*)<\/a>)?\s*(?:<a class="btn btn-primary" href="([^"]*)">([^<]*)<\/a>)?\s*<\/div>\s*<\/div>$/

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  eacute: 'é',
  ntilde: 'ñ',
  copy: '©',
  reg: '®',
  trade: '™',
}

/** Decodes the entities the page uses. Returns null for an entity it does not know, so the block stays locked. */
export function decodeText(html: string): string | null {
  if (/&(?![a-z0-9#]+;)/i.test(html)) return null
  let unknown = false
  const text = html.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code)
      unknown = true
      return whole
    }
    const value = NAMED[name]
    if (value === undefined) unknown = true
    return value ?? whole
  })
  return unknown ? null : text
}

export function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll(' ', '&nbsp;')
}

function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function link(href: string | undefined, label: string | undefined): DisasterLink | null | undefined {
  if (href === undefined) return null
  const decodedHref = decodeText(href)
  const decodedLabel = decodeText(label ?? '')
  return decodedHref === null || decodedLabel === null ? undefined : { href: decodedHref, label: decodedLabel }
}

/** Reads one block. Returns null when it is not exactly the known card markup. */
export function parseCard(html: string, key: string, hidden: boolean): DisasterCard | null {
  const match = CARD.exec(html.trim())
  if (!match) return null
  const [
    ,
    imageClass,
    imageUrl,
    imageStyle,
    padding,
    title,
    description,
    learnHref,
    learnLabel,
    donateHref,
    donateLabel,
  ] = match
  const decodedTitle = decodeText(title ?? '')
  const decodedDescription = decodeText(description ?? '')
  const decodedImage = imageUrl === undefined ? null : decodeText(imageUrl)
  const learnMore = link(learnHref, learnLabel)
  const donate = link(donateHref, donateLabel)
  if (
    decodedTitle === null ||
    decodedDescription === null ||
    (imageUrl !== undefined && decodedImage === null) ||
    learnMore === undefined ||
    donate === undefined
  )
    return null
  return {
    kind: 'card',
    key,
    hidden,
    title: decodedTitle,
    description: decodedDescription,
    imageUrl: decodedImage,
    imageClass: imageClass ?? null,
    imageStyle: imageStyle ?? '',
    padding: padding ?? 'p-5',
    learnMore,
    donate,
  }
}

function summary(html: string): string {
  const text = html
    .replace(/<!--|-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 140 ? text.slice(0, 139) + '…' : text
}

/** Finds the end of the block that opens at `start`, by counting nested divs. */
function blockEnd(source: string, start: number): number {
  const tag = /<(\/?)div\b[^>]*>/gi
  tag.lastIndex = start
  let depth = 0
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    depth += match[1] ? -1 : 1
    if (depth === 0) return match.index + match[0].length
  }
  return -1
}

type Span = { start: number; end: number; inner: string; hidden: boolean }

function spans(source: string): Span[] {
  const found: Span[] = []
  let position = 0
  while (position < source.length) {
    const comment = source.indexOf('<!--', position)
    const card = source.indexOf(CARD_OPEN, position)
    if (card === -1 && comment === -1) break
    if (comment !== -1 && (card === -1 || comment < card)) {
      const close = source.indexOf('-->', comment + 4)
      if (close === -1) break
      const inner = source.slice(comment + 4, close)
      // Only a comment that holds a card belongs to the list; any other comment is ordinary surrounding markup.
      if (inner.includes(CARD_OPEN)) found.push({ start: comment, end: close + 3, inner, hidden: true })
      position = close + 3
      continue
    }
    const end = blockEnd(source, card)
    if (end === -1) break
    found.push({ start: card, end, inner: source.slice(card, end), hidden: false })
    position = end
  }
  return found
}

export function parseDisasterBody(source: string): DisasterDocument {
  const found = spans(source)
  const first = found[0]
  const last = found.at(-1)
  if (!first || !last) return { before: source, after: '', blocks: [], gaps: [], source }
  const blocks: Parsed[] = []
  const gaps: string[] = []
  found.forEach((span, i) => {
    const previous = found[i - 1]
    if (previous) {
      const between = source.slice(previous.end, span.start)
      if (between.trim()) {
        // Unrecognised markup between cards is kept as its own locked block so nothing is lost.
        blocks.push({
          item: { kind: 'locked', key: `block-${blocks.length}`, hidden: false, summary: summary(between) },
          raw: between,
        })
        gaps.push('')
      } else gaps.push(between)
    }
    const key = `block-${blocks.length}`
    const raw = source.slice(span.start, span.end)
    blocks.push({
      item: parseCard(span.inner, key, span.hidden) ?? {
        kind: 'locked',
        key,
        hidden: span.hidden,
        summary: summary(raw),
      },
      raw,
    })
  })
  return { before: source.slice(0, first.start), after: source.slice(last.end), blocks, gaps, source }
}

export function disasterItems(document: DisasterDocument): DisasterItem[] {
  return document.blocks.map(block => block.item)
}

export function cardHtml(card: DisasterCard): string {
  const imageClass = card.imageClass ? `${card.imageClass} ` : ''
  const style = card.imageUrl
    ? ` style="background-image: url('${escapeAttribute(card.imageUrl)}');${card.imageStyle}"`
    : ''
  const buttons = [
    card.learnMore &&
      `<a class="btn btn-secondary" href="${escapeAttribute(card.learnMore.href)}">${escapeText(card.learnMore.label)}</a>`,
    card.donate &&
      `<a class="btn btn-primary" href="${escapeAttribute(card.donate.href)}">${escapeText(card.donate.label)}</a>`,
  ]
    .filter(Boolean)
    .join(' ')
  const html = [
    CARD_OPEN,
    `<div class="col-md-3 ${imageClass}disasterCardImg rounded-3"${style}></div>`,
    `<div class="col-md-9 rounded-3 h-100 ${card.padding}">`,
    `<h2>${escapeText(card.title)}</h2>`,
    `<p>${escapeText(card.description)}</p>`,
    `${buttons}</div>`,
    '</div>',
  ].join('\n')
  // A hidden card is an HTML comment. Escaped text cannot contain `-->`, so it cannot end the comment early.
  return card.hidden ? `<!--\n${html}\n-->` : html
}

function fieldsOf(fields: CardFields): string {
  return JSON.stringify([fields.title, fields.description, fields.imageUrl, fields.learnMore, fields.donate])
}

export class DisasterEditError extends Error {}

/**
 * Applies the editor's list to a fresh read of the field. Every existing block
 * comes from `document`; the edit only supplies plain-text fields, order and
 * visibility. Returns the original source exactly when nothing changed.
 */
export function applyDisasterEdits(document: DisasterDocument, edits: CardEdit[]): string {
  const byKey = new Map(document.blocks.map(block => [block.item.key, block]))
  const seen = new Set<string>()
  const pieces: { html: string; key: string | null }[] = []
  for (const edit of edits) {
    if (seen.has(edit.key)) throw new DisasterEditError('The same card appears twice. Reload and try again.')
    seen.add(edit.key)
    const block = byKey.get(edit.key)
    if (edit.kind === 'locked') {
      if (!block || block.item.kind !== 'locked')
        throw new DisasterEditError('The page changed in Zesty while you were editing. Reload to see it.')
      pieces.push({ html: block.raw, key: edit.key })
      continue
    }
    if (block && block.item.kind !== 'card')
      throw new DisasterEditError('The page changed in Zesty while you were editing. Reload to see it.')
    if (!block && !edit.key.startsWith('new-'))
      throw new DisasterEditError('The page changed in Zesty while you were editing. Reload to see it.')
    const base = block?.item.kind === 'card' ? block.item : null
    const unchanged = base && base.hidden === edit.hidden && fieldsOf(base) === fieldsOf(edit)
    pieces.push({
      key: block ? edit.key : null,
      html:
        unchanged && block
          ? block.raw
          : cardHtml({
              kind: 'card',
              key: edit.key,
              hidden: edit.hidden,
              title: edit.title,
              description: edit.description,
              imageUrl: edit.imageUrl,
              learnMore: edit.learnMore,
              donate: edit.donate,
              imageClass: edit.imageUrl ? null : (base?.imageClass ?? null),
              imageStyle: edit.imageUrl && base?.imageUrl ? base.imageStyle : '',
              padding: base?.padding ?? 'p-5',
            }),
    })
  }
  for (const block of document.blocks)
    if (block.item.kind === 'locked' && !seen.has(block.item.key))
      throw new DisasterEditError('Content the editor cannot change was left out. Reload and try again.')
  if (!pieces.length) return document.before + document.after
  // Keep the original spacing between two blocks that are still next to each other.
  const keys = document.blocks.map(block => block.item.key)
  const body = pieces
    .map((piece, i) => {
      if (i === 0) return piece.html
      const previous = pieces[i - 1]
      const at = piece.key ? keys.indexOf(piece.key) : -1
      const gap = at > 0 && previous?.key === keys[at - 1] ? document.gaps[at - 1] : undefined
      return (gap === undefined || gap === '' ? '\n' : gap) + piece.html
    })
    .join('')
  return document.before + body + document.after
}

export type CardProblem = { key: string; field: keyof CardFields; message: string }

const HTTPS = /^https:\/\/[^\s"'<>\\]+$/i

/** Checks what an editor typed before anything is sent to Zesty. */
export function validateCards(edits: CardEdit[]): CardProblem[] {
  const problems: CardProblem[] = []
  for (const edit of edits) {
    if (edit.kind !== 'card') continue
    const problem = (field: keyof CardFields, message: string) => problems.push({ key: edit.key, field, message })
    if (!edit.title.trim()) problem('title', 'Add a title.')
    else if (edit.title.length > 200) problem('title', 'Keep the title under 200 characters.')
    if (!edit.description.trim()) problem('description', 'Add a description.')
    else if (edit.description.length > 2000) problem('description', 'Keep the description under 2,000 characters.')
    if (edit.imageUrl !== null && !HTTPS.test(edit.imageUrl))
      problem('imageUrl', 'Use an image address that starts with https://.')
    else if (edit.imageUrl === null && edit.key.startsWith('new-')) problem('imageUrl', 'Add an image address.')
    for (const field of ['learnMore', 'donate'] as const) {
      const value = edit[field]
      if (!value) continue
      if (!HTTPS.test(value.href)) problem(field, 'Use a link that starts with https://.')
      if (!value.label.trim()) problem(field, 'Add the button text.')
    }
  }
  return problems
}
