import { describe, expect, it } from 'vitest'
import { nativeDisclosureCss } from './native-disclosure-css.ts'

describe('native imported FAQ styles', () => {
  it('keeps declarations and conditional scope while adding the native open selector', () => {
    const result = nativeDisclosureCss(
      '@media(min-width:1px){.scope .faq-item.is-open>.faq-answer{grid-template-rows:1fr}.scope .faq-item.is-open>.faq-answer p{opacity:1;padding:0 1.4rem 1.4rem}}',
    )
    expect(result).toContain('.scope .faq-item[open]>.faq-answer{grid-template-rows:1fr}')
    expect(result).toContain('.scope .faq-item[open]>.faq-answer p{opacity:1;padding:0 1.4rem 1.4rem}')
    expect(result.startsWith('@media(min-width:1px){')).toBe(true)
    expect(result.endsWith('}}')).toBe(true)
  })
  it('does not interpret declaration strings or another element’s class as FAQ state', () => {
    const css = '.scope .faq-item{content:".faq-item.is-open"}.scope .faq-item .is-open{color:red}'
    expect(nativeDisclosureCss(css)).toBe(css)
  })
  it('copies only matching selector branches and retains the original class behavior', () => {
    const css = '.scope .faq-item.is-open>.answer,.scope .other{opacity:1}'
    const result = nativeDisclosureCss(css)
    expect(result.startsWith(css)).toBe(true)
    expect(result.slice(css.length)).toBe('.scope .faq-item[open]>.answer{opacity:1}')
  })
})
