import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { collectCss, renderSection, type ManifestSection } from './render.ts'
import { narrowCompiledCss, CSS_POLICY_VERSION } from './css.ts'

function section(version: number, color: string): ManifestSection {
  const compiled = compileSection({
    sourceHtml: '<p class="copy">Text</p>',
    sourceCss: `.copy{color:${color}}`,
    slots: [],
    scopeSelector: '.cms-section--shared',
  })
  return {
    instance: { section_def_id: 'shared', section_def_version: version, values: {} },
    def: {
      section_def_id: 'shared',
      version,
      slug: 'shared',
      compiled_ast: compiled.ast,
      css: compiled.css,
      slots: [],
      sanitizer_policy_version: compiled.ast.policyVersion,
      css_policy_version: CSS_POLICY_VERSION,
    },
  }
}

describe('styles for mixed pinned section versions', () => {
  it('keeps a new version from restyling the old instances on the same page', () => {
    const old = section(1, 'red'),
      next = section(2, 'blue')
    const css = collectCss([old, next, old])
    expect(css).toContain('.cms-section--shared:where(#s0,#s2) .copy{color:red}')
    expect(css).toContain('.cms-section--shared:where(#s1) .copy{color:blue}')
    expect(renderSection(old, 0)).toContain('id="s0" class="cms-section cms-section--shared"')
  })
  it('keeps single-version output unchanged and preserves custom CSS precedence', () => {
    const old = section(1, 'red')
    expect(collectCss([old, old])).toContain(old.def.css)
    expect(collectCss([old, old])).not.toContain(':where(')
    const next = {
      ...section(2, 'blue'),
      instance: { section_def_id: 'shared', section_def_version: 2, values: {}, custom_css: '.copy{color:green}' },
    }
    const css = collectCss([old, next])
    expect(css).toContain('#s1 .copy{color:green}')
    expect(css.indexOf('color:green')).toBeGreaterThan(css.indexOf('color:blue'))
  })
  it('parses selector lists without altering strings or conditional rules', () => {
    const css =
      '.cms-section--shared .a:is(.x,.y),.cms-section--shared:hover::before{content:".cms-section--shared"}@media (max-width:600px){.cms-section--shared .a{display:none}}'
    const output = narrowCompiledCss(css, '.cms-section--shared', [0])
    expect(output).toContain(':where(#s0) .a:is(.x,.y)')
    expect(output).toContain(':where(#s0):hover::before')
    expect(output).toContain('content:".cms-section--shared"')
    expect(output).toContain('@media (max-width:600px)')
  })
  it('does not narrow ungoverned CSS or accept caller-supplied selector syntax as an index', () => {
    expect(narrowCompiledCss('body{color:red}', '.cms-section--shared', [0])).toBeNull()
    expect(narrowCompiledCss('.cms-section--shared .a{color:red}', '.cms-section--shared', [Number.NaN])).toBeNull()
  })
})
