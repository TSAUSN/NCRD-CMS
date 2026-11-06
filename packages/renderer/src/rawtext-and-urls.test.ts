// Raw-text end tags, and URLs found by tokenizing rather than by pattern.
//
// Two reproductions, both from reading the code rather than from the corpus,
// and both the same shape of mistake: a check that recognises the *spelling* of
// a thing rather than the thing.
import { describe, expect, it } from 'vitest'
import { compileSection, SANITIZER_POLICY_VERSION } from './compile.ts'
import { scanSlotSites } from './context.ts'
import { scopeCss, CSS_POLICY_VERSION } from './css.ts'
import { renderSection, type ManifestSection } from './render.ts'
import type { SlotDef } from '@cms/schema'

const slots: SlotDef[] = [{ id: 'value', kind: 'text', label: 'V', constraints: {} } as SlotDef]

function render(template: string, value: string): string {
  const compiled = compileSection({ sourceHtml: template, slots })
  return renderSection(
    {
      def: {
        section_def_id: 'd',
        version: 1,
        slug: 'd',
        compiled_ast: compiled.ast,
        css: compiled.css,
        slots,
        render_hash: 'h',
        sanitizer_policy_version: SANITIZER_POLICY_VERSION,
        css_policy_version: CSS_POLICY_VERSION,
      },
      instance: { label: 'S', hidden: false, hidden_at: [], values: { value } },
    } as unknown as ManifestSection,
    0,
  )
}

const contextOf = (template: string) => scanSlotSites(template)[0]?.context ?? 'none'

describe('raw text ends only at the appropriate end tag', () => {
  it('the reported reproduction: </scriptx> does not leave a script element', () => {
    // Was: classified element-text, no blocking problem, and Chromium ran it.
    const template = '<script>/*</scriptx>*/{{value}}</script>'
    expect(contextOf(template)).toBe('raw-text')

    const compiled = compileSection({ sourceHtml: template, slots })
    expect(compiled.blocking.join(' ')).toContain('script, style, title or textarea')
    expect(render(template, 'globalThis.__pwned=1')).toBe('')
  })

  it.each([
    ['script', '<script>', '</scriptx>', '</script>'],
    ['style', '<style>', '</stylex>', '</style>'],
    ['textarea', '<textarea>', '</textareax>', '</textarea>'],
    ['title', '<title>', '</titlex>', '</title>'],
  ])('%s: a longer name is not the end tag', (_label, open, fake, close) => {
    expect(contextOf(`${open}${fake}{{value}}${close}`)).toBe('raw-text')
  })

  it.each([
    ['a following >', '<style>x</style>{{value}}'],
    ['a following space', '<style>x</style >{{value}}'],
    ['a following slash', '<style>x</style/>{{value}}'],
    ['a following tab', `<style>x</style${String.fromCharCode(9)}>{{value}}`],
    ['a following newline', `<style>x</style${String.fromCharCode(10)}>{{value}}`],
    ['upper case', '<STYLE>x</STYLE>{{value}}'],
    ['mixed case', '<style>x</StYlE>{{value}}'],
  ])('%s ends a style element', (_label, template) => {
    // Style, title and textarea have no escaped states — the delimiter rule is
    // the whole story for them, so the scanner can and does follow it exactly.
    expect(contextOf(template)).toBe('element-text')
  })

  it.each([
    ['an apparent close', '<script>x</script>{{value}}'],
    ['two apparent closes', '<script></script></script>{{value}}'],
    ['upper case', '<SCRIPT>x</SCRIPT>{{value}}'],
    ['a comment around it', '<script><!-- </script> --> {{value}}</script>'],
    ['nested script text', '<script>var a = "<script>";</script>{{value}}'],
  ])('%s does NOT end a script element', (_label, template) => {
    // Script is one-way. HTML's escaped and double-escaped states mean an
    // apparent `</script>` sometimes closes the element and sometimes does not,
    // and the scanner declines to guess which.
    expect(contextOf(template)).toBe('raw-text')
  })

  it('an unterminated raw-text element keeps everything after it raw', () => {
    expect(contextOf('<script>{{value}}')).toBe('raw-text')
    expect(contextOf('<script>x</script{{value}}')).toBe('raw-text')
  })

  it('is blocking however the definition is approved', () => {
    // Trusted-code approval is a super admin accepting an author's markup. It
    // is not a decision anyone can make about escaping, because there is no
    // escaping inside a script element to decide about.
    const compiled = compileSection({ sourceHtml: '<script>{{value}}</script>', slots })
    expect(compiled.carriesTrustedCode).toBe(true)
    expect(compiled.blocking.length).toBeGreaterThan(0)
  })
})

describe('url() is found by tokenizing, not by spelling', () => {
  it('the reported reproduction: an escaped identifier', () => {
    // Was: emitted verbatim with no violation, and Chromium fetched it.
    const result = scopeCss('.a{background:u\\72l(https://evil.test/x)}', '.s')
    expect(result.css).toBe('')
    expect(result.violations).toContain('url() may only reference this site')
  })

  it.each([
    ['escaped lower case', '.a{background:u\\72l(https://evil.test/x)}'],
    ['escaped upper case with a delimiter', '.a{background:U\\52 L(https://evil.test/x)}'],
    ['mixed case', '.a{background:UrL(https://evil.test/x)}'],
    ['whitespace inside', '.a{background:url( "https://evil.test/x" )}'],
    ['nested in image-set', '.a{background:image-set(u\\72l(https://evil.test/x) 1x)}'],
    ['a bare string in image-set', '.a{background:image-set("https://evil.test/x" 1x)}'],
    ['cross-fade', '.a{background:cross-fade(url(https://evil.test/x) 50%)}'],
    ['a protocol-relative path', '.a{background:url(//evil.test/x)}'],
    ['every character escaped', '.a{background:\\75\\72\\6c(https://evil.test/x)}'],
    ['src()', '@font-face{src:src("https://evil.test/f.woff")}'],
  ])('refuses %s', (_label, css) => {
    const result = scopeCss(css, '.s')
    expect(result.css).not.toContain('evil.test')
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it.each([
    ['a plain path', '.a{background:url(/ok.png)}'],
    ['an escaped identifier with a same-origin path', '.a{background:u\\72l(/ok.png)}'],
    ['a quoted path with whitespace', '.a{background:url( "/ok.png" )}'],
    ['upper case with a same-origin path', '.a{background:URL(/ok.png)}'],
  ])('keeps %s working', (_label, css) => {
    const result = scopeCss(css, '.s')
    expect(result.css).toContain('url("/ok.png")')
    expect(result.violations).toEqual([])
  })

  it('normalises to one form, so nothing downstream has to decode again', () => {
    expect(scopeCss('.a{background:u\\72l(/ok.png)}', '.s').css).toBe(scopeCss('.a{background:url(/ok.png)}', '.s').css)
  })

  it.each([
    ['an unclosed function', '.a{background:url(/ok.png}'],
    ['a bad url token', '.a{background:url(/ok".png)}'],
  ])('fails closed on %s', (_label, css) => {
    const result = scopeCss(css, '.s')
    expect(result.css).toBe('')
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('is at policy version 6, because selectors are tokenized', () => {
    expect(CSS_POLICY_VERSION).toBe(6)
  })
})

describe('the policy versions moved together with the semantics', () => {
  it('sanitizer policy is 4, because classification changed again', () => {
    expect(SANITIZER_POLICY_VERSION).toBe(4)
  })
})
