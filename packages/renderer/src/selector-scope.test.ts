// Selector scopes are tokens, and a slug is a grammar.
//
// A CSS identifier does not end where its characters suggest. `\65` is `e`, a
// comment is not a boundary, and every character can be spelled as an escape —
// so a validator that looks at "the character after the scope" is answering a
// question about text while the browser answers one about identifiers.
import { describe, expect, it } from 'vitest'
import { isSectionSlug, SECTION_SLUG } from '@cms/schema'
import { sectionScopeSelector } from './compile.ts'
import { CSS_POLICY_VERSION, scopeCss, validateCompiledCss } from './css.ts'
import { parseScopeToken, scopeSelectorList, selectorIsScoped } from './selector.ts'

const SCOPE = '.cms-section--d'

describe('the reported reproduction', () => {
  it('a stored artifact whose scope is continued by an escape', () => {
    // Was: no problems. Chromium resolves \65 to e, so this is the class
    // `cms-section--devil` — definition `d` styling definition `devil`.
    expect(validateCompiledCss(String.raw`.cms-section--d\65 vil{color:red}`, SCOPE)).not.toEqual([])
  })

  it('authored CSS can no longer produce it', () => {
    // The other half, and the more important one: `&\65 vil` was scoped by
    // string replacement, which put the scope next to characters the author
    // chose. Producing the bypass was as easy as writing it.
    const result = scopeCss(String.raw`&\65 vil { color: rgb(1, 2, 3); }`, SCOPE)
    expect(result.css).toBe('')
    expect(result.violations.join(' ')).toContain('could not be confined')
  })
})

describe('no spelling of an identifier changes which class it is', () => {
  it.each([
    ['a hex escape', String.raw`.cms-section--d\65 vil{color:red}`],
    ['every character escaped', String.raw`.cms-section--d\65 \76 \69 \6c{color:red}`],
    ['an escaped digit', String.raw`.cms-section--d\32 x{color:red}`],
    ['escaped punctuation', String.raw`.cms-section--d\.evil{color:red}`],
    ['no whitespace after the escape', String.raw`.cms-section--d\65vil{color:red}`],
    ['upper-case hex', String.raw`.cms-section--d\45 vil{color:red}`],
    ['a scope-lookalike class', '.cms-section--devil{color:red}'],
    ['another definition entirely', '.cms-section--other .a{color:red}'],
    ['an unscoped branch', 'body{color:red}'],
    ['one good branch and one escaped', String.raw`.cms-section--d .ok,.cms-section--d\65 vil{color:red}`],
    ['inside a media query', String.raw`@media screen{.cms-section--d\65 vil{color:red}}`],
    [
      'inside nested conditionals',
      String.raw`@media screen{@supports (display:grid){.cms-section--d\65 vil{color:red}}}`,
    ],
    ['a pseudo-class wrapper as the first compound', ':is(.cms-section--d,body){color:red}'],
  ])('refuses %s', (_label, css) => {
    expect(validateCompiledCss(css, SCOPE), css).not.toEqual([])
  })

  it.each([
    ['the scope alone', '.cms-section--d{color:red}'],
    ['a descendant', '.cms-section--d .a{color:red}'],
    ['a compound', '.cms-section--d.big{color:red}'],
    ['a pseudo on the scope', '.cms-section--d:hover{color:red}'],
    ['two rooted branches', '.cms-section--d .a,.cms-section--d .b{color:red}'],
    ['inside a media query', '@media (min-width:700px){.cms-section--d .a{color:red}}'],
    ['inside nested conditionals', '@media screen{@supports (display:grid){.cms-section--d .a{color:red}}}'],
    ['an escaped class later in the branch', String.raw`.cms-section--d .a\.b{color:red}`],
  ])('accepts %s', (_label, css) => {
    expect(validateCompiledCss(css, SCOPE), css).toEqual([])
  })
})

describe('scope insertion is structural', () => {
  it('a selector naming an element outside the section is still scoped, not refused', () => {
    // `body` cannot be a descendant of a section, so this matches nothing — but
    // it is correctly *confined*, which is the property being checked. Refusing
    // it would be a different rule, about usefulness rather than safety.
    expect(scopeCss('body{color:red}', SCOPE).css).toBe('.cms-section--d body{color:red}')
  })

  it.each([
    ['a bare class', '.a{color:red}', '.cms-section--d .a{color:red}'],
    ['nesting with a pseudo', '&:hover{color:red}', '.cms-section--d:hover{color:red}'],
    ['nesting with a class', '&.big{color:red}', '.cms-section--d.big{color:red}'],
    ['a selector list', '.a,.b{color:red}', '.cms-section--d .a,.cms-section--d .b{color:red}'],
  ])('scopes %s', (_label, authored, expected) => {
    expect(scopeCss(authored, SCOPE).css).toBe(expected)
  })

  it.each([
    ['nesting continued by an escape', String.raw`&\65 vil{color:red}`],
    ['nesting continued by an identifier', '&evil{color:red}'],
  ])('refuses %s rather than emitting something that means more', (_label, authored) => {
    const result = scopeCss(authored, SCOPE)
    expect(result.css, authored).toBe('')
    expect(result.violations.length, authored).toBeGreaterThan(0)
  })

  it('applies the same rule to per-block custom CSS', () => {
    // Block CSS is scoped to an id rather than a class, and had the identical
    // hole: `&\65 vil` under `#s0` produced `#s0\65 vil`, the id `s0evil`.
    expect(scopeCss(String.raw`&\65 vil{color:red}`, '#s0').css).toBe('')
    expect(scopeCss('.a{color:red}', '#s0').css).toBe('#s0 .a{color:red}')
  })
})

describe('a scope is one class or one id, or it is not a scope', () => {
  it.each([
    ['a class', '.cms-section--d', { kind: 'class', identifier: 'cms-section--d' }],
    ['an id', '#s0', { kind: 'id', identifier: 's0' }],
    // Spelling does not matter, which is the point of resolving rather than
    // comparing text: `.a\65 b` and `.aeb` are the same class to a browser and
    // so they are the same scope here.
    ['an escaped spelling', String.raw`.a\65 b`, { kind: 'class', identifier: 'aeb' }],
  ])('reads %s', (_label, selector, expected) => {
    expect(parseScopeToken(selector)).toEqual(expected)
  })

  it.each([
    ['a tag', 'a'],
    ['a selector list', '.a,.b'],
    ['a descendant', '.a .b'],
    ['a compound', '.a.b'],
    ['nothing', ''],
    ['syntax', '.a{'],
  ])('refuses %s', (_label, selector) => {
    expect(parseScopeToken(selector)).toBeNull()
    expect(selectorIsScoped('.x', selector)).toBe(false)
    expect(scopeSelectorList('.x', selector)).toBeNull()
  })
})

describe('a slug is constrained where it becomes a class name', () => {
  it.each([
    ['empty', ''],
    ['undefined', undefined as unknown as string],
    ['a space', ' '],
    ['a comma', 'a,body'],
    ['a dot', 'a.b'],
    ['a hash', 'a#b'],
    ['brackets', 'a[x]'],
    ['a child combinator', 'a>b'],
    ['a sibling combinator', 'a~b'],
    ['a backslash', 'a\\b'],
    ['a tab', `a${String.fromCharCode(9)}b`],
    ['a null byte', `a${String.fromCharCode(0)}b`],
    ['a Cyrillic lookalike', 'а'],
    ['a leading dash', '-a'],
    ['a trailing dash', 'a-'],
    ['a doubled dash', 'a--b'],
    ['upper case', 'Hero'],
    ['65 characters', 'a'.repeat(65)],
    ['a colon', 'a:hover'],
    ['a star', '*'],
  ])('refuses %s', (_label, slug) => {
    expect(isSectionSlug(slug), slug).toBe(false)
    expect(sectionScopeSelector(slug), slug).toBeNull()
  })

  it.each([['hero'], ['cta'], ['hero-split-v1'], ['a1'], ['a'.repeat(64)]])('accepts %s', slug => {
    expect(isSectionSlug(slug)).toBe(true)
    expect(sectionScopeSelector(slug)).toBe(`.cms-section--${slug}`)
    // And the scope it produces is a scope: exactly one class token.
    expect(parseScopeToken(sectionScopeSelector(slug)!)).toEqual({ kind: 'class', identifier: `cms-section--${slug}` })
  })

  it('has one expression, shared with the database', () => {
    expect(SECTION_SLUG.source).toBe('^[a-z0-9]+(?:-[a-z0-9]+)*$')
  })
})

describe('the policy version moved with the semantics', () => {
  it('is 6', () => {
    expect(CSS_POLICY_VERSION).toBe(6)
  })
})
