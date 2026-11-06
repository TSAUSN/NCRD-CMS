import { afterEach, expect, it, vi } from 'vitest'
import * as css from './css.ts'
import { compileSection } from './compile.ts'
import { compiledCssProblems, type SectionDefView } from './render.ts'

function definition(slug: string, artifact = `.cms-section--${slug}{color:red}`): SectionDefView {
  const compiled = compileSection({ sourceHtml: '<p>Text</p>', sourceCss: '', slots: [] })
  return {
    section_def_id: 'same-definition',
    version: 1,
    slug,
    compiled_ast: compiled.ast,
    css: artifact,
    css_policy_version: css.CSS_POLICY_VERSION,
    sanitizer_policy_version: compiled.ast.policyVersion,
    slots: [],
  }
}

afterEach(() => vi.restoreAllMocks())

it('reuses validation only for the exact compiled bytes and scope', () => {
  const validate = vi.spyOn(css, 'validateCompiledCss')
  const def = definition('cache-exact')
  expect(compiledCssProblems(def)).toEqual([])
  expect(compiledCssProblems({ ...def, section_def_id: 'another-definition', version: 2 })).toEqual([])
  expect(validate).toHaveBeenCalledTimes(1)
  expect(compiledCssProblems({ ...def, css: 'body{color:red}' }).length).toBeGreaterThan(0)
  expect(compiledCssProblems({ ...def, slug: 'cache-other-scope' }).length).toBeGreaterThan(0)
  expect(validate).toHaveBeenCalledTimes(3)
})

it('still checks policy and scope before reusing a valid stylesheet', () => {
  const def = definition('cache-policy')
  expect(compiledCssProblems(def)).toEqual([])
  expect(compiledCssProblems({ ...def, css_policy_version: css.CSS_POLICY_VERSION + 1 }).join(' ')).toContain(
    'policy version',
  )
  expect(compiledCssProblems({ ...def, slug: 'invalid scope' }).join(' ')).toContain('cannot be a section scope')
})

it('does not let a caller erase a cached refusal', () => {
  const validate = vi.spyOn(css, 'validateCompiledCss')
  const def = definition('cache-refusal', 'body{color:red}')
  const first = compiledCssProblems(def)
  expect(first.length).toBeGreaterThan(0)
  first.length = 0
  expect(compiledCssProblems(def).length).toBeGreaterThan(0)
  expect(validate).toHaveBeenCalledTimes(1)
})

it('bounds the number of distinct artifacts retained', () => {
  const validate = vi.spyOn(css, 'validateCompiledCss')
  const first = definition('cache-entry-bound')
  compiledCssProblems(first)
  for (let n = 0; n < 64; n++) compiledCssProblems(definition(`cache-entry-${n}`))
  validate.mockClear()
  expect(compiledCssProblems(first)).toEqual([])
  expect(validate).toHaveBeenCalledTimes(1)
})

it('bounds retained characters and does not retain an oversized stylesheet', () => {
  const validate = vi.spyOn(css, 'validateCompiledCss')
  const first = definition('cache-byte-bound', ' '.repeat(600_000) + '.cms-section--cache-byte-bound{color:red}')
  const second = definition('cache-byte-other', ' '.repeat(600_000) + '.cms-section--cache-byte-other{color:red}')
  expect(compiledCssProblems(first)).toEqual([])
  expect(compiledCssProblems(second)).toEqual([])
  validate.mockClear()
  compiledCssProblems(first)
  expect(validate).toHaveBeenCalledTimes(1)
  const oversized = definition('cache-oversized', ' '.repeat(1_000_000) + '.cms-section--cache-oversized{color:red}')
  validate.mockClear()
  expect(compiledCssProblems(oversized)).toEqual([])
  expect(compiledCssProblems(oversized)).toEqual([])
  expect(validate).toHaveBeenCalledTimes(2)
})
