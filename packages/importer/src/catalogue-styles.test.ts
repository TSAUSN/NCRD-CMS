import { describe, expect, it } from 'vitest'
import { validateCompiledCss } from '@cms/renderer'
import { catalogueStyles } from './catalogue-styles.ts'
import { convertDefinition } from './convert.ts'
import { presetStylesheet } from './source.ts'

const html =
  '<section class="card"><a class="fx-lift" data-block-id="cta" data-editable="link" href="/give">Give</a></section>'
const css = '.fx-lift{color:blue}.card{padding:1rem}'
const base = {
  id: 'preset-fixture',
  html,
  css,
  slots: [{ blockId: 'cta', editable: 'link', label: 'Action', role: null }],
  presetClasses: ['fx-lift'],
}
const presetCss =
  ':root{--fx-dur:.2s}.fx-lift{color:red;transition:transform var(--fx-dur)}' +
  '.fx-lift:focus-visible{transform:translateY(-2px)}' +
  '@media (hover:hover) and (pointer:fine){.fx-lift:hover{transform:translateY(-2px)}}' +
  '@media (prefers-reduced-motion:reduce){.fx-lift{transition:none}}' +
  '.other-template{padding:20rem}'

describe('source-owned catalogue preset styling', () => {
  it('preserves preset state rules, reduced motion, local tokens and the source cascade', () => {
    const result = convertDefinition({ ...base, presetCss })
    expect(result.status).toBe('automatic')
    expect(result.reasons).toEqual([])
    const compiled = result.compiledCss!
    expect(compiled).toContain('.cms-section--preset-fixture{--fx-dur:.2s}')
    expect(compiled).not.toContain(':root')
    expect(compiled).toContain('.fx-lift:focus-visible')
    expect(compiled).toContain('@media (hover:hover) and (pointer:fine)')
    expect(compiled).toContain('.fx-lift:hover')
    expect(compiled).toContain('@media (prefers-reduced-motion:reduce)')
    expect(compiled).toContain('transition:none')
    expect(compiled).not.toContain('other-template')
    expect(compiled.indexOf('color:red')).toBeLessThan(compiled.indexOf('color:blue'))
    expect(validateCompiledCss(compiled, '.cms-section--preset-fixture')).toEqual([])
  })

  it('retains preset rules even when template CSS defines the same class', () => {
    const result = convertDefinition({ ...base, presetCss })
    expect(result.measurements.borrowedClasses).toEqual([])
    expect(result.compiledCss).toContain('transition:transform var(--fx-dur)')
  })

  it('keeps the missing stylesheet refusal when no source CSS was supplied', () => {
    const result = convertDefinition({ ...base, css: '.card{padding:1rem}' })
    expect(result.reasons.map(reason => reason.code)).toContain('interaction-preset-css')
    expect(result.document).toBeNull()
  })

  it('does not accept an empty or unrelated stylesheet as evidence for a borrowed class', () => {
    for (const presetCss of ['', '.other{color:red}']) {
      const result = convertDefinition({ ...base, css: '', presetCss })
      expect(result.reasons.map(reason => reason.code)).toContain('interaction-preset-css')
      expect(result.document).toBeNull()
    }
  })

  it.each([
    ':root{color:red}.fx-lift{color:red}',
    'html .fx-lift{color:red}',
    'body{--fx-dur:.2s}.fx-lift{color:red}',
    ':root,.fx-lift{--fx-dur:.2s}',
    ':root .absent{color:red}.fx-lift{color:red}',
    '.fx-lift{',
  ])('refuses root behavior or an unreadable dependency before closure: %s', presetCss => {
    const result = convertDefinition({ ...base, presetCss })
    expect(result.status).toBe('quarantined')
    expect(result.reasons.map(reason => reason.code)).toContain('interaction-preset-css')
    expect(result.document).toBeNull()
  })

  it.each([
    '@import "https://elsewhere.test/style.css";.fx-lift{color:red}',
    '.fx-lift{background:url(https://elsewhere.test/pixel)}',
    '.fx-lift{width:expression(alert(1))}',
    '@keyframes spin{from{opacity:0}to{opacity:1}}.fx-lift{animation:spin 1s}',
  ])('keeps CSS-policy quarantine for retained dependency declarations: %s', presetCss => {
    const result = convertDefinition({ ...base, presetCss })
    expect(result.status).toBe('quarantined')
    expect(result.reasons.some(reason => ['css-rejected', 'css-policy-dropped'].includes(reason.code))).toBe(true)
    expect(result.compiledCss).toBeNull()
  })

  it('leaves unsupported interactive elements quarantined even with their CSS present', () => {
    const result = convertDefinition({
      ...base,
      html: html.replace('</section>', '<button>Open</button></section>'),
      presetCss,
    })
    expect(result.reasons.map(reason => reason.code)).toContain('button-element')
    expect(result.document).toBeNull()
  })

  it('does not mutate source styles and yields byte-identical merged styles', () => {
    const first = catalogueStyles(html, css, presetCss)
    expect(catalogueStyles(html, css, presetCss)).toBe(first)
    expect(presetCss.startsWith(':root{')).toBe(true)
    expect(first.endsWith(css)).toBe(true)
  })
})

describe('reading a CSS constant without evaluating source JavaScript', () => {
  it('extracts plain constant bytes without running surrounding code', () => {
    expect(
      presetStylesheet('throw new Error("never execute");\nexport const INTERACTION_PRESET_CSS = `.fx{color:red}`'),
    ).toBe('.fx{color:red}')
  })
  it.each([
    'export const INTERACTION_PRESET_CSS = `.fx{color:${color}}`',
    'export const INTERACTION_PRESET_CSS = `.fx::after{content:"\\201C"}`',
    'export const INTERACTION_PRESET_CSS = `.fx{color:red}',
    'export const INTERACTION_PRESET_CSS = `.fx{color:red}` + dynamicStyles',
    'export const INTERACTION_PRESET_CSS = `.fx{color:red}`\n+ dynamicStyles',
  ])('refuses interpolation, JavaScript escape ambiguity or an unclosed literal', source => {
    expect(() => presetStylesheet(source)).toThrow()
  })
})
