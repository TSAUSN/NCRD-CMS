import { describe, expect, it } from 'vitest'
import { scopeCss, validateCompiledCss } from './css.ts'

// Tailwind v4 utilities build shadows, rings, border styles, gradients and
// transforms from custom properties that only `@property` gives a starting value.
const scope = '.cms-section--cards'
const tailwind =
  '@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}' +
  '@property --tw-ring-color{syntax:"*";inherits:false}' +
  '@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}' +
  '@property --tw-leading{syntax:"*";inherits:true;initial-value:1.5}' +
  '.card{box-shadow:var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow)}.shadow-lg{--tw-shadow:0 4px 24px rgba(19,34,48,.06)}.border{border-style:var(--tw-border-style);border-width:1px}'

describe('registered custom properties in section CSS', () => {
  it('keeps their starting values inside the section, before every other rule', () => {
    const { css, violations, blocking } = scopeCss(tailwind, scope)
    expect(blocking).toEqual([])
    expect(violations).toEqual([])
    expect(
      css.startsWith(
        `${scope},${scope} *,${scope} ::before,${scope} ::after{--tw-shadow:0 0 #0000;--tw-border-style:solid}${scope}{--tw-leading:1.5}`,
      ),
    ).toBe(true)
    expect(css).toContain(`${scope} .shadow-lg{--tw-shadow:0 4px 24px rgba(19,34,48,.06)}`)
    // The stored-artifact check accepts it, so the section renders.
    expect(validateCompiledCss(css, scope)).toEqual([])
  })

  it('types a bare zero by its registered syntax, as the browser would', () => {
    const { css } = scopeCss(
      '@property --w{syntax:"<length>";inherits:false;initial-value:0}@property --p{syntax:"<percentage>";inherits:false;initial-value:0}' +
        '@property --a{syntax:"<angle>";inherits:false;initial-value:0}@property --n{syntax:"<number>";inherits:false;initial-value:0}@property --any{syntax:"*";inherits:false;initial-value:0}.a{color:red}',
      scope,
    )
    expect(css).toContain('{--w:0px;--p:0%;--a:0deg;--n:0;--any:0}')
  })

  it('keeps nothing from a registration it cannot vouch for', () => {
    for (const [source, reason] of [
      ['@property --x{initial-value:url(//evil.example/a.png)}', /--x has a starting value/],
      ['@property --x{initial-value:expression(alert(1))}', /--x has a starting value/],
      ['@property not-custom{initial-value:1}', /not-custom has a starting value/],
    ] as const) {
      const { css, violations } = scopeCss(`${source}.a{color:red}`, scope)
      expect(css).toBe(`${scope} .a{color:red}`)
      expect(violations.join(' ')).toMatch(reason)
    }
    expect(scopeCss('@property --x{initial-value:"</style><script>"}.a{color:red}', scope).css).not.toContain('<')
  })
})
