// A stored slot id is not syntax, and a stored artifact is not evidence.
//
// Three reproductions, one theme. Each time, a value that had been treated as a
// harmless label turned out to be an input to something that parses.
import { describe, expect, it } from 'vitest'
import { SLOT_ID } from '@cms/schema'
import {
  bindContexts,
  compileSection,
  upgradeCompiledSection,
  SANITIZER_POLICY_VERSION,
  SCRIPT_AND_SLOTS,
} from './compile.ts'
import { CSS_POLICY_VERSION, validateCompiledCss } from './css.ts'
import { renderSection, type ManifestSection } from './render.ts'

function renderStored(ast: unknown, values: Record<string, unknown>, css = ''): string {
  return renderSection(
    {
      def: {
        section_def_id: 'd',
        version: 1,
        slug: 'd',
        compiled_ast: ast,
        css,
        slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }],
        render_hash: 'h',
        sanitizer_policy_version: SANITIZER_POLICY_VERSION,
        css_policy_version: CSS_POLICY_VERSION,
      },
      instance: { label: 'S', hidden: false, hidden_at: [], values },
    } as unknown as ManifestSection,
    0,
  )
}

describe('a slot id cannot alter context reconstruction', () => {
  const forged = {
    nodes: [
      { kind: 'html', value: '<p>' },
      { kind: 'slot', slotId: 'a}}</p><div title="', slotKind: 'text', context: 'element-text' },
      { kind: 'html', value: '</p><div ' },
      { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'quoted-attribute', attribute: 'title' },
      { kind: 'html', value: '>x</div>' },
    ],
    policyVersion: SANITIZER_POLICY_VERSION,
    cssPolicyVersion: CSS_POLICY_VERSION,
  }

  it('the reported reproduction', () => {
    // Was: current: true, blocking: [], and `<div onclick=alert(1)>`. The id
    // closed the marker it was interpolated into, so the second slot — which
    // genuinely sits in a bare attribute position — was re-derived as a quoted
    // attribute and escaped for a place it was not.
    const upgraded = upgradeCompiledSection(forged)
    expect(upgraded.blocking.join(' ')).toContain('not a usable slot id')
    expect(upgraded.current).toBe(false)
    expect(renderStored(forged, { value: 'onclick=alert(1)' })).toBe('')
  })

  it.each([
    ['closing braces', 'a}}b'],
    ['opening braces', 'a{{b'],
    ['a double quote', 'a"b'],
    ['a single quote', "a'b"],
    ['angle brackets', 'a<b>c'],
    ['a space', 'a b'],
    ['a tab', `a${String.fromCharCode(9)}b`],
    ['a newline', `a${String.fromCharCode(10)}b`],
    ['a null byte', `a${String.fromCharCode(0)}b`],
    ['a zero-width space', `a${String.fromCharCode(0x200b)}b`],
    ['a Cyrillic lookalike', 'vаlue'],
    ['a leading digit', '1value'],
    ['an empty string', ''],
    ['sixty-five characters', 'a'.repeat(65)],
    ['a sentinel of our own', '__cms_slot_0__'],
  ])('refuses an id containing %s', (_label, slotId) => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<p>' },
        { kind: 'slot', slotId, slotKind: 'text', context: 'element-text' },
        { kind: 'html', value: '</p>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: CSS_POLICY_VERSION,
    }
    // Sentinels are the exception that proves the grammar: `__cms_slot_0__` is
    // a legal id, so it is refused for a different reason — it is the marker
    // reconstruction uses, and a real slot must not be able to impersonate one.
    expect(renderStored(ast, { [slotId]: 'x' })).toBe('')
  })

  it.each([
    ['a plain word', 'value'],
    ['digits after a letter', 'slot1'],
    ['dashes and underscores', 'a-b_c'],
    ['sixty-four characters', `a${'b'.repeat(63)}`],
  ])('accepts %s', (_label, slotId) => {
    expect(SLOT_ID.test(slotId)).toBe(true)
  })

  it('refuses a slot kind outside the supported set', () => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<p>' },
        { kind: 'slot', slotId: 'value', slotKind: 'script', context: 'element-text' },
        { kind: 'html', value: '</p>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: CSS_POLICY_VERSION,
    }
    expect(bindContexts(ast.nodes as never).blocking.join(' ')).toContain('which this renderer cannot fill')
    expect(renderStored(ast, { value: 'x' })).toBe('')
  })

  it('refuses an html node carrying a reconstruction marker', () => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<p>{{__cms_slot_0__}}</p><div ' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'quoted-attribute' },
        { kind: 'html', value: '>x</div>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: CSS_POLICY_VERSION,
    }
    expect(bindContexts(ast.nodes as never).blocking.join(' ')).toContain('a marker no compiler emits')
    expect(renderStored(ast, { value: 'onclick=alert(1)' })).toBe('')
  })

  it('still binds a legitimate AST with two uses of one id', () => {
    const ast = {
      nodes: [
        { kind: 'html', value: '<p>' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
        { kind: 'html', value: '</p><p>' },
        { kind: 'slot', slotId: 'value', slotKind: 'text', context: 'element-text' },
        { kind: 'html', value: '</p>' },
      ],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: CSS_POLICY_VERSION,
    }
    expect(bindContexts(ast.nodes as never).blocking).toEqual([])
    expect(renderStored(ast, { value: 'hi' })).toContain('<p>hi</p><p>hi</p>')
  })
})

describe('a script element and editable slots do not mix', () => {
  it('the reported reproduction: script-data double-escaped', () => {
    // Was: element-text, no blocking problem, and Chromium ran it.
    const template = '<script><!--<script></script>-->\n{{value}}</script>'
    const compiled = compileSection({
      sourceHtml: template,
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking).toContain(SCRIPT_AND_SLOTS)
    expect(renderStored(compiled.ast, { value: 'globalThis.__doubleEscaped=1' })).toBe('')
  })

  it.each([
    ['an escaped comment', '<script><!-- </script> --> {{value}}</script>'],
    ['nested script text', '<script>var a = "<script>";</script>{{value}}'],
    ['mixed casing', '<script><!--<SCRIPT></SCRIPT>-->{{value}}</script>'],
    ['two apparent closes', '<script></script></script>{{value}}'],
    ['a slot before the script', '{{value}}<script>x</script>'],
    ['a slot in an attribute of another element', '<script>x</script><div title="{{value}}">y</div>'],
  ])('refuses %s', (_label, template) => {
    const compiled = compileSection({
      sourceHtml: template,
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking).toContain(SCRIPT_AND_SLOTS)
  })

  it('a script with no slots is still allowed, as approved static markup', () => {
    const compiled = compileSection({ sourceHtml: '<script>console.log(1)</script>', slots: [] })
    expect(compiled.blocking).toEqual([])
    expect(compiled.carriesTrustedCode).toBe(true)
  })

  it('a template with slots and no script is unaffected', () => {
    const compiled = compileSection({
      sourceHtml: '<p>{{value}}</p>',
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.blocking).toEqual([])
  })

  it('approval cannot make a data slot executable', () => {
    // Trusted-code approval is a super admin accepting markup an author pasted.
    // It was never a decision that a typed field may become code, and the two
    // were one flag away from each other.
    const compiled = compileSection({
      sourceHtml: '<script>{{value}}</script>',
      slots: [{ id: 'value', kind: 'text', label: 'V', constraints: {} }] as never,
    })
    expect(compiled.carriesTrustedCode).toBe(true)
    expect(compiled.blocking.length).toBeGreaterThan(0)
  })
})

describe('compiled CSS is validated, not believed', () => {
  it.each([
    ['a rule hidden inside an at-rule', '@media all{body{background:url(https://evil.test/x)}}'],
    ['an unscoped branch after a comma', '.cms-section--d .safe,body{background:url(https://evil.test/x)}'],
    ['a scope-lookalike class', '.cms-section--devil body{background:url(https://evil.test/x)}'],
    ['another definition’s scope', '.cms-section--other .a{color:red}'],
    ['an off-site url in a scoped rule', '.cms-section--d .a{background:url(https://evil.test/x)}'],
    ['an escaped off-site url', '.cms-section--d .a{background:u\\72l(https://evil.test/x)}'],
    ['markup', '.cms-section--d .a{content:"</style><script>alert(1)</script>"}'],
    ['a loading at-rule', '@import url(//evil.test/x.css);'],
    ['an unsupported at-rule', '@font-face{src:url(/f.woff)}'],
    ['malformed css', '.cms-section--d .a{color:red'],
  ])('refuses %s', (_label, css) => {
    expect(validateCompiledCss(css, '.cms-section--d').length).toBeGreaterThan(0)
  })

  it.each([
    ['a scoped rule', '.cms-section--d .a{color:red}'],
    ['the scope alone', '.cms-section--d{color:red}'],
    ['a scoped rule in a media query', '@media (min-width:700px){.cms-section--d .a{color:red}}'],
    ['nested conditionals', '@media screen{@supports (display:grid){.cms-section--d .a{color:red}}}'],
    ['a same-origin url', '.cms-section--d .a{background:url("/ok.png")}'],
  ])('accepts %s', (_label, css) => {
    expect(validateCompiledCss(css, '.cms-section--d')).toEqual([])
  })

  it('refuses to render a section whose compiled CSS is unscoped', () => {
    const ast = {
      nodes: [{ kind: 'html', value: '<p>hi</p>' }],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: CSS_POLICY_VERSION,
    }
    expect(renderStored(ast, {}, '.cms-section--d .a,body{display:none}')).toBe('')
    expect(renderStored(ast, {}, '.cms-section--d .a{color:red}')).toContain('<p>hi</p>')
  })

  it('refuses compiled CSS claiming a policy version it does not have', () => {
    const section = {
      def: {
        section_def_id: 'd',
        version: 1,
        slug: 'd',
        compiled_ast: {
          nodes: [{ kind: 'html', value: '<p>hi</p>' }],
          policyVersion: SANITIZER_POLICY_VERSION,
          cssPolicyVersion: 1,
        },
        css: '.cms-section--d .a{color:red}',
        slots: [],
        render_hash: 'h',
        sanitizer_policy_version: SANITIZER_POLICY_VERSION,
        css_policy_version: 1,
      },
      instance: { label: 'S', hidden: false, hidden_at: [], values: {} },
    } as unknown as ManifestSection
    expect(renderSection(section, 0)).toBe('')
  })
})
