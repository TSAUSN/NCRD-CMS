import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'

// V1's catalogue explains some declarations with a comment inside the rule.
// That is ordinary CSS: the comment is left out like any other, the rule's
// declarations all ship, and nobody is told a rule was dropped.
describe('a comment inside a rule', () => {
  it('compiles the rule whole and reports nothing', () => {
    const compiled = compileSection({
      sourceHtml: '<div class="fill">{{t}}</div>',
      slots: [{ id: 't', kind: 'text', label: 'T', constraints: {} }],
      sourceCss: '.fill{/* driven by the section progress */width:var(--section-progress,68%);background:#c00}',
      scopeSelector: '.cms-section--x',
    })
    expect(compiled.problems).toEqual([])
    expect(compiled.css).toContain('.cms-section--x .fill{width:var(--section-progress,68%);background:#c00}')
  })
  it('still reports a nested rule', () => {
    const compiled = compileSection({
      sourceHtml: '<div class="a">x</div>',
      slots: [],
      sourceCss: '.a{color:red;.b{color:blue}}',
      scopeSelector: '.cms-section--x',
    })
    expect(compiled.problems).toContain('nested rules are not supported in section CSS')
  })
})
