// The save boundary for page metadata (finding S-02).
//
// `SeoMeta` was exported and never imported: nothing called it, so every
// constraint it declared was aspirational and the only real bound on a page's
// metadata was the 1 MiB whole-content cap in migration 0001. These are the
// cases that boundary now has to answer.
import { describe, expect, it } from 'vitest'
import { SeoMeta, parsePageMeta } from './seo.ts'

const problems = (value: unknown) => {
  const parsed = parsePageMeta(value)
  return parsed.ok ? [] : parsed.problems
}
const fields = (value: unknown) => problems(value).map(p => p.field)

describe('what the boundary accepts', () => {
  it('accepts an empty object, which is what a page starts with', () => {
    const parsed = parsePageMeta({})
    expect(parsed.ok && parsed.meta.noindex).toBe(false)
  })

  it('accepts every field it declares', () => {
    expect(
      parsePageMeta({
        title: 'T',
        description: 'D',
        canonical: '/p',
        social_image: '/i.png',
        noindex: true,
      }).ok,
    ).toBe(true)
  })

  it('accepts a canonical at exactly the maximum length', () => {
    expect(parsePageMeta({ canonical: `/${'x'.repeat(2047)}` }).ok).toBe(true)
  })

  it('refuses a canonical one character over it', () => {
    expect(fields({ canonical: `/${'x'.repeat(2048)}` })).toEqual(['canonical'])
  })
})

describe('what it refuses, and what it tells the author', () => {
  it.each([
    ['a title that is not text', { title: 7 }, 'title'],
    ['a description that is not text', { description: [] }, 'description'],
    ['a canonical that is not text', { canonical: { href: '/p' } }, 'canonical'],
    ['a noindex that is not a flag', { noindex: 'yes' }, 'noindex'],
    ['an unexpected nested shape', { title: { text: 'T' } }, 'title'],
  ])('refuses %s and names the field', (_label, value, field) => {
    expect(fields(value)).toContain(field)
  })

  it.each([
    ['a string', 'title=T'],
    ['a number', 7],
    ['an array', []],
    ['null', null],
  ])('refuses %s, which is not metadata at all', (_label, value) => {
    expect(parsePageMeta(value).ok).toBe(false)
  })

  it('names every broken field at once, not just the first', () => {
    expect(fields({ title: 1, description: 2, noindex: 'no' }).sort()).toEqual(['description', 'noindex', 'title'])
  })
})

describe('an unknown key is refused, not silently dropped', () => {
  // The choice that matters. A plain z.object strips what it does not
  // recognise, and this boundary had never run before — so its first act would
  // have been to delete whatever an older or newer build had stored, invisibly
  // and permanently.
  it('refuses a key this build does not know', () => {
    expect(parsePageMeta({ title: 'T', og_locale: 'en_GB' }).ok).toBe(false)
  })

  it('says which key, so the author or the next build can act on it', () => {
    expect(JSON.stringify(problems({ og_locale: 'en_GB' }))).toContain('og_locale')
  })

  it('does not quietly return a value with the key removed', () => {
    const parsed = SeoMeta.safeParse({ title: 'T', og_locale: 'en_GB' })
    expect(parsed.success).toBe(false)
  })
})

describe('null and omitted are different questions', () => {
  it('accepts an omitted optional field', () => {
    expect(parsePageMeta({ title: 'T' }).ok).toBe(true)
  })

  it('refuses an explicit null, because null is a value and not an absence', () => {
    expect(parsePageMeta({ title: null }).ok).toBe(false)
  })
})

describe('canonical ownership is not this schema’s question', () => {
  it('accepts a shape-valid canonical naming another host', () => {
    // Deliberate. This schema validates one page in isolation and is never
    // given the site, so it cannot know which host is verified. Answering
    // "is this URL ours?" here would be a second, weaker copy of the renderer's
    // rule, and the weaker copy is the one an attacker gets to choose.
    expect(parsePageMeta({ canonical: 'https://evil.test/x' }).ok).toBe(true)
  })
})
