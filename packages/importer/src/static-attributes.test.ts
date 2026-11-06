// The v2 static-attribute grammar, one V1 shape at a time.
//
// Every test here is about the same rule stated from a different side: an
// attribute is carried when it fits the model exactly, and the whole element is
// refused when any part of it does not. The cases that matter are the near
// misses — a class list with one framework-utility token, a `target` naming a
// context the model refuses, a `width` with no `height` — because those are the
// ones where dropping the offending part and keeping the rest would look like a
// successful import and would render a page nobody authored.

import { describe, expect, it } from 'vitest'
import { STRUCTURED_DIMENSION_MAX, isStructuredStaticAttributeValue } from '@cms/schema'
import { imageStaticAttributes, linkStaticAttributes } from './static-attributes.ts'
import type { HtmlAttribute } from './html.ts'

/** An element's attributes, written the way the parser hands them over. */
const attrs = (pairs: Record<string, string>): HtmlAttribute[] =>
  Object.entries(pairs).map(([name, value]) => ({ name, value }))

/** The names a refusal reported, or a failure if it did not refuse at all. */
function lost(mapping: ReturnType<typeof linkStaticAttributes | typeof imageStaticAttributes>): string[] {
  if (mapping.ok) throw new Error(`expected a refusal, got ${JSON.stringify(mapping.staticAttributes)}`)
  return mapping.lost
}

/** What a mapping carried, or a failure if it refused. */
function carried(mapping: ReturnType<typeof linkStaticAttributes>) {
  if (!mapping.ok) throw new Error(`expected a mapping, got a refusal over ${mapping.lost.join(' ')}`)
  return mapping.staticAttributes
}

function carriedImage(mapping: ReturnType<typeof imageStaticAttributes>) {
  if (!mapping.ok) throw new Error(`expected a mapping, got a refusal over ${mapping.lost.join(' ')}`)
  return mapping.staticAttributes
}

describe('a link element’s attributes, mapped onto a link field node', () => {
  it('carries a class list as tokens, in the order V1 wrote them', () => {
    // Order is preserved rather than sorted: the renderer emits the array
    // verbatim, so the markup can still be read against the markup it came from.
    expect(carried(linkStaticAttributes(attrs({ class: 'btn btn--primary is-wide' })))).toEqual({
      class: ['btn', 'btn--primary', 'is-wide'],
    })
  })

  it('carries rel and target when both come from the closed sets', () => {
    expect(carried(linkStaticAttributes(attrs({ rel: 'noopener noreferrer', target: '_blank' })))).toEqual({
      rel: ['noopener', 'noreferrer'],
      target: '_blank',
    })
  })

  it('carries nothing at all as no object, rather than as an empty one', () => {
    expect(carried(linkStaticAttributes([]))).toBeUndefined()
  })

  it('writes its keys in the schema’s emission order whatever order V1 used', () => {
    const mapping = carried(linkStaticAttributes(attrs({ target: '_self', class: 'btn', rel: 'help' })))
    expect(Object.keys(mapping!)).toEqual(['class', 'rel', 'target'])
  })

  it('refuses a whole class list over one framework-utility token, keeping none of it', () => {
    for (const utility of ['sm:px-6', 'bg-white/95', 'tracking-[0.14em]']) {
      const mapping = linkStaticAttributes(attrs({ class: `btn ${utility} is-wide` }))
      // Not `{ class: ['btn', 'is-wide'] }`. The utility is a selector something
      // in V1 matched, so an import that dropped it would change the page and
      // report success.
      expect(lost(mapping), utility).toEqual(['class(value)'])
    }
  })

  it('refuses a class list that repeats a token, because the model refuses one', () => {
    expect(lost(linkStaticAttributes(attrs({ class: 'btn btn' })))).toEqual(['class(value)'])
  })

  it('refuses an empty class list, which is different markup from no class at all', () => {
    expect(lost(linkStaticAttributes(attrs({ class: '' })))).toEqual(['class(value)'])
  })

  it('refuses spacing it would have to rewrite to store', () => {
    // The renderer emits `tokens.join(' ')`. A source that is not already in
    // that form is one this importer would be normalising, and an importer that
    // normalises somebody else's markup produces output nobody can diff.
    expect(lost(linkStaticAttributes(attrs({ class: 'btn  btn--primary' })))).toEqual(['class(value)'])
    expect(lost(linkStaticAttributes(attrs({ class: ' btn' })))).toEqual(['class(value)'])
    expect(lost(linkStaticAttributes(attrs({ class: 'btn ' })))).toEqual(['class(value)'])
  })

  it('refuses a rel keyword the model’s closed set does not contain', () => {
    // `me` is a real rel keyword and is deliberately not in the model's set,
    // which is exactly the case a token grammar would have let through.
    expect(lost(linkStaticAttributes(attrs({ rel: 'me' })))).toEqual(['rel(value)'])
    expect(lost(linkStaticAttributes(attrs({ rel: 'nofollow prefetch' })))).toEqual(['rel(value)'])
  })

  it('refuses a target naming a context the section does not own', () => {
    expect(lost(linkStaticAttributes(attrs({ target: '_top' })))).toEqual(['target(value)'])
    expect(lost(linkStaticAttributes(attrs({ target: '_parent' })))).toEqual(['target(value)'])
    expect(lost(linkStaticAttributes(attrs({ target: 'sidebar' })))).toEqual(['target(value)'])
  })

  it('refuses an attribute the model has no name for, and says so as a bare name', () => {
    // A bare name and a `name(value)` are two different pieces of work: one
    // needs the model to grow, the other needs the definition to be rewritten.
    expect(lost(linkStaticAttributes(attrs({ style: 'color:red' })))).toEqual(['style'])
    expect(lost(linkStaticAttributes(attrs({ 'data-registration-cta': 'x' })))).toEqual(['data-registration-cta'])
    expect(lost(linkStaticAttributes(attrs({ id: 'cta' })))).toEqual(['id'])
    expect(lost(linkStaticAttributes(attrs({ onclick: 'go()' })))).toEqual(['onclick'])
    expect(lost(linkStaticAttributes(attrs({ 'aria-label': 'Give' })))).toEqual(['aria-label'])
  })

  it('reports every name it could not carry, in one stable order', () => {
    expect(lost(linkStaticAttributes(attrs({ target: '_top', 'data-tone': 'warm', style: 'x' })))).toEqual([
      'data-tone',
      'style',
      'target(value)',
    ])
  })

  it('refuses the whole element when one attribute fails and the rest would fit', () => {
    const mapping = linkStaticAttributes(attrs({ class: 'btn', target: '_blank', style: 'color:red' }))
    expect(lost(mapping)).toEqual(['style'])
    expect(mapping.ok).toBe(false)
  })
})

describe('an image element’s attributes, mapped onto an image field node', () => {
  it('carries the six names the model has, in the schema’s emission order', () => {
    const mapping = carriedImage(
      imageStaticAttributes(
        attrs({
          loading: 'lazy',
          width: '1600',
          height: '900',
          decoding: 'async',
          fetchpriority: 'high',
          class: 'shot',
        }),
      ),
    )
    expect(mapping).toEqual({
      class: ['shot'],
      width: 1600,
      height: 900,
      decoding: 'async',
      loading: 'lazy',
      fetchpriority: 'high',
    })
    expect(Object.keys(mapping!)).toEqual(['class', 'width', 'height', 'decoding', 'loading', 'fetchpriority'])
  })

  it('stores a dimension as the number the model holds, never as the digits V1 wrote', () => {
    const mapping = carriedImage(imageStaticAttributes(attrs({ width: '10', height: '8' })))
    expect(mapping).toEqual({ width: 10, height: 8 })
    expect(typeof mapping!.width).toBe('number')
  })

  it('refuses a lone width, because one dimension reserves the wrong box', () => {
    expect(lost(imageStaticAttributes(attrs({ width: '1600' })))).toEqual(['width(unpaired)'])
    expect(lost(imageStaticAttributes(attrs({ height: '900' })))).toEqual(['height(unpaired)'])
  })

  it('refuses the survivor when its partner’s value fails the grammar', () => {
    // `height` is lost on its value and `width` is then a lone dimension, and
    // both are named: carrying the width alone is the case the pairing rule
    // exists to prevent, and it would otherwise look like a partial success.
    expect(lost(imageStaticAttributes(attrs({ width: '1600', height: '90%' })))).toEqual([
      'height(value)',
      'width(unpaired)',
    ])
  })

  it('refuses a dimension that is not a plain in-range integer', () => {
    for (const bad of ['0', '100%', '12px', '-1', '1e3', ' 12', '', String(STRUCTURED_DIMENSION_MAX + 1)]) {
      expect(lost(imageStaticAttributes(attrs({ width: bad, height: '8' }))), bad).toContain('width(value)')
    }
  })

  it('refuses a dimension whose digits it would have to rewrite to store', () => {
    // `0080` and `80` are the same integer and different bytes, and storing the
    // second for a source that wrote the first is the same silent rewriting the
    // class rule refuses — it just looks harmless because it is a number.
    // `height` is named too, and correctly: with the width gone it is the lone
    // dimension the pairing rule refuses.
    expect(lost(imageStaticAttributes(attrs({ width: '0080', height: '8' })))).toEqual([
      'height(unpaired)',
      'width(value)',
    ])
  })

  it('accepts the bounds themselves, which is where an off-by-one would hide', () => {
    expect(
      carriedImage(imageStaticAttributes(attrs({ width: '1', height: String(STRUCTURED_DIMENSION_MAX) }))),
    ).toEqual({ width: 1, height: STRUCTURED_DIMENSION_MAX })
  })

  it('refuses a loading, decoding or fetchpriority outside its enum', () => {
    expect(lost(imageStaticAttributes(attrs({ loading: 'auto' })))).toEqual(['loading(value)'])
    expect(lost(imageStaticAttributes(attrs({ decoding: 'fast' })))).toEqual(['decoding(value)'])
    expect(lost(imageStaticAttributes(attrs({ fetchpriority: 'urgent' })))).toEqual(['fetchpriority(value)'])
  })

  it('refuses an inline style, which is a second CSS sink outside the one policy', () => {
    expect(lost(imageStaticAttributes(attrs({ style: 'object-position:50% 20%', width: '10', height: '8' })))).toEqual([
      'style',
    ])
  })

  it('refuses the link-only names, because an image has neither', () => {
    expect(lost(imageStaticAttributes(attrs({ target: '_blank' })))).toEqual(['target'])
    expect(lost(imageStaticAttributes(attrs({ rel: 'noopener' })))).toEqual(['rel'])
  })

  it('refuses srcset and sizes, which have no grammar the model can close', () => {
    expect(lost(imageStaticAttributes(attrs({ srcset: '/a.webp 1x' })))).toEqual(['srcset'])
    expect(lost(imageStaticAttributes(attrs({ sizes: '100vw' })))).toEqual(['sizes'])
  })
})

describe('everything the mapping carries, held against the schema’s own predicate', () => {
  // The mapping is only worth anything if the schema agrees with it, so the
  // agreement is asserted rather than assumed: every value that comes out is put
  // back through `isStructuredStaticAttributeValue`, which is the function the
  // database and the renderer both ask.
  it('produces link values the schema accepts, entry by entry', () => {
    const mapping = carried(
      linkStaticAttributes(
        attrs({
          class: 'btn btn--primary',
          rel: 'external nofollow',
          target: '_blank',
        }),
      ),
    )!
    for (const [name, value] of Object.entries(mapping)) {
      expect(isStructuredStaticAttributeValue('link', name, value), name).toBe(true)
    }
  })

  it('produces image values the schema accepts, entry by entry', () => {
    const mapping = carriedImage(
      imageStaticAttributes(
        attrs({
          class: 'shot',
          width: '1600',
          height: '900',
          decoding: 'async',
          loading: 'lazy',
          fetchpriority: 'high',
        }),
      ),
    )!
    for (const [name, value] of Object.entries(mapping)) {
      expect(isStructuredStaticAttributeValue('image', name, value), name).toBe(true)
    }
  })

  it('never carries the values a field node owns, whatever the caller passes', () => {
    // `href`, `src` and `alt` are the author's, and the converter removes them
    // before asking. If one ever arrives here it must be refused rather than
    // stored, because a definition that could also write a URL would make "did
    // this URL pass the policy?" a question with two answers.
    expect(lost(linkStaticAttributes(attrs({ href: '/give' })))).toEqual(['href'])
    expect(lost(imageStaticAttributes(attrs({ src: '/a.webp', alt: 'A' })))).toEqual(['alt', 'src'])
  })
})
