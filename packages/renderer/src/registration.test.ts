import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { renderPage } from './render.ts'
import { stripPreviewInstrumentation, PREVIEW_RUNTIME } from './preview-runtime.ts'
import { applyRegistrationAvailability, isRealRegistrationUrl } from './registration.ts'

// V1 Echelon's event-readiness rule (src/event-readiness.js), without a script.
const cta = (href: string, extra = '') =>
  `<a class="button button-red registration-unavailable" href="${href}" data-registration-cta=""${extra}>Register Now</a>`
const STATUS =
  '<span class="button registration-status" role="status" data-registration-status="">Registration details coming soon</span>'

describe('registration calls to action', () => {
  it('counts only a present, non-anchor http(s) destination as registration', () => {
    for (const url of [
      'https://events.example.org/echelon',
      'http://example.org/register',
      '/register',
      'register.html?year=2027',
    ])
      expect({ url, real: isRealRegistrationUrl(url) }).toEqual({ url, real: true })
    for (const url of [
      '',
      '   ',
      '#register',
      '/#register',
      '/?year=2027#register',
      '#',
      'mailto:events@example.org',
      'tel:5551234',
      'javascript:alert(1)',
      null,
      undefined,
    ])
      expect({ url, real: isRealRegistrationUrl(url) }).toEqual({ url, real: false })
  })

  it('keeps a placeholder link hidden and its status note showing, byte for byte', () => {
    const html = `<header>${cta('#register')}</header><main>${STATUS}<a href="#agenda">Agenda</a></main>`
    expect(applyRegistrationAvailability(html)).toBe(html)
  })

  it('shows a link that goes somewhere real and hides the status note, touching nothing else', () => {
    const html = `<header>${cta('https://events.example.org/echelon?a=1&amp;b=2')}</header><main>${STATUS}${cta('#register')}</main>`
    expect(applyRegistrationAvailability(html)).toBe(
      '<header><a class="button button-red" href="https://events.example.org/echelon?a=1&amp;b=2" data-registration-cta="">Register Now</a></header>' +
        '<main><span class="button registration-status registration-unavailable" role="status" data-registration-status="">Registration details coming soon</span>' +
        `${cta('#register')}</main>`,
    )
  })

  it('hides a registration link that lost its fail-safe class when it goes nowhere real, and ignores other elements', () => {
    expect(applyRegistrationAvailability('<a href="#register" data-registration-cta>Register</a>')).toBe(
      '<a href="#register" data-registration-cta class="registration-unavailable">Register</a>',
    )
    expect(
      applyRegistrationAvailability(
        `<a class="  footer-link\n  registration-unavailable" href="/register" title="a > b" data-registration-cta>Register</a>`,
      ),
    ).toBe('<a class="footer-link" href="/register" title="a > b" data-registration-cta>Register</a>')
    const button = '<button class="registration-unavailable" data-registration-cta="">Register</button>'
    expect(applyRegistrationAvailability(button)).toBe(button)
  })
})

describe('registration on a rendered page', () => {
  const slots = [
    { id: 'href', kind: 'link' as const, label: 'Register · destination', constraints: { destinationOnly: true } },
    { id: 'words', kind: 'text' as const, label: 'Register · label', constraints: {} },
  ]
  const sourceHtml =
    '<section class="register"><a class="button registration-unavailable" href="{{href}}" data-registration-cta="" data-block-id="hero-cta-primary" data-editable="link">{{words}}</a></section>'
  const compiled = compileSection({
    sourceHtml,
    sourceCss: '.registration-unavailable{display:none!important}',
    slots,
    scopeSelector: '.cms-section--register',
  })
  const page = (url: string, preview = false) =>
    renderPage({
      manifest: {
        page: { id: 'p', path: '/', title: 'Echelon' },
        meta: { title: 'Echelon' },
        fonts: [],
        sections: [
          {
            def: {
              section_def_id: 'd',
              version: 1,
              slug: 'register',
              compiled_ast: compiled.ast,
              css: compiled.css,
              css_policy_version: compiled.ast.cssPolicyVersion,
              slots,
            },
            instance: {
              section_def_id: 'd',
              section_def_version: 1,
              values: { href: { url }, words: 'Register Now' },
              hidden: false,
              hidden_at: [],
              label: '',
            },
          },
        ],
      } as never,
      shell: {
        site: { id: 's', name: 'Echelon', slug: 'echelon' },
        theme: {},
        navigation: [],
        canonical_host: null,
        staging_host: null,
      } as never,
      isStaging: false,
      options: preview ? { preview: true } : {},
    }).html

  it('publishes the link only once an editor gives it a real address, in previews and on the public page alike', () => {
    expect(compiled.blocking).toEqual([])
    expect(page('#register')).toContain('class="button registration-unavailable" href="#register"')
    expect(page('https://events.example.org/echelon')).toContain(
      'class="button" href="https://events.example.org/echelon"',
    )
    for (const url of ['#register', 'https://events.example.org/echelon'])
      expect(stripPreviewInstrumentation(page(url, true))).toBe(page(url))
  })

  it('shows a placeholder link on the editing canvas so it can be selected and given an address', () => {
    expect(PREVIEW_RUNTIME).toContain("querySelectorAll('a[data-registration-cta].registration-unavailable')")
    expect(() => new Function(PREVIEW_RUNTIME)).not.toThrow()
  })
})
