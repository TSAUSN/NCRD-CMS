import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { runReadinessChecks } from '../../domain/src/readiness.ts'
import { echelonFlowHeaderStyles, pageDecorationStyles, referenceStyles } from './reference-styles.ts'
import { inertReference } from './inert-reference.ts'

describe('the V1 document stylesheet inside a V2 section', () => {
  const echelonHero = readFileSync(new URL('./__fixtures__/echelon-hero.css', import.meta.url), 'utf8')

  it('removes the real Echelon fixed-header allowance when the header is in flow, preserving content spacing', () => {
    const result = referenceStyles(echelonHero, { inFlowEchelonHeader: true })
    expect(result.css).not.toMatch(/padding-top:\s*(90|78)px/)
    expect(result.css).toContain('min-height: calc(min(690px, 92vh) - 90px)')
    expect(result.css).toContain('min-height: calc(min(690px, 92vh) - 78px)')
    expect(result.css).toContain('padding: clamp(1.5rem, 5vw, 4rem)')
    expect(result.css).toContain('padding: 3rem 1.25rem 2.35rem')
    expect(result.issues).toContain('echelon-fixed-header-space-removed-from-hero')
    expect(referenceStyles(echelonHero).css).toContain('padding-top: 90px')
    expect(echelonFlowHeaderStyles(result.css)).toEqual({ css: result.css, issues: [], changed: false })
    const compiled = compileSection({
      sourceHtml:
        '<div class="v1-reference-root"><section class="hero"><div class="hero-copy">Echelon</div></section></div>',
      sourceCss: result.css,
      slots: [],
      scopeSelector: sectionScopeSelector('echelon-hero')!,
    })
    expect(compiled.blocking).toEqual([])
    expect(compiled.problems).toEqual([])
  })

  it('recognizes the compiled media syntax without guessing at changed hero dimensions', () => {
    expect(echelonFlowHeaderStyles(echelonHero.replace('(max-width: 900px)', '(width <= 900px)')).changed).toBe(true)
    const changedSource = echelonHero.replace('min(690px, 92vh)', 'min(720px, 92vh)')
    expect(echelonFlowHeaderStyles(changedSource)).toEqual({
      css: changedSource,
      changed: false,
      issues: ['echelon-hero-header-offset-review-required'],
    })
  })
  it('keeps the page background colour on each section root without repeating page glows or fixed overlays (FID-05)', () => {
    const source =
      'body{min-width:320px;background:radial-gradient(circle at 6% 10%,rgba(246,202,79,.12),transparent 26rem),radial-gradient(circle at 94% 6%,rgba(221,82,81,.07),transparent 30rem),var(--cream);color:var(--ink)}' +
      'body::before{content:"";position:fixed;inset:0;z-index:-1;opacity:.32;background-image:radial-gradient(rgba(228,120,66,.16) 1px,transparent 1.4px)}' +
      '.hero::before{content:"";position:absolute;inset:0}.card{background:linear-gradient(red,blue),#fff}'
    const result = referenceStyles(source)
    expect(result.css).toContain('.v1-reference-root{min-width:320px;background:var(--cream);color:var(--ink)}')
    expect(result.css).not.toContain('.v1-reference-root::before')
    expect(result.css).toContain('.hero::before{content:"";position:absolute;inset:0}')
    expect(result.css).toContain('.card{background:linear-gradient(red,blue),#fff}')
    expect(result.issues).toContain('page-decoration-not-repeated-per-section')
    // The same repair reaches stylesheets stored by an earlier import.
    const stored =
      '.v1-reference-root{background:radial-gradient(circle at 6% 10%,#f6ca4f1f,transparent 26rem),var(--cream);margin:0}.v1-reference-root:before{content:"";position:fixed;opacity:.32}'
    expect(pageDecorationStyles(stored)).toEqual({
      css: '.v1-reference-root{background:var(--cream);margin:0}',
      changed: true,
    })
    expect(pageDecorationStyles('.v1-reference-root{background:#fff}')).toEqual({
      css: '.v1-reference-root{background:#fff}',
      changed: false,
    })
  })
  it('carries source theme variables and compiled utilities into a local root', () => {
    const result = referenceStyles(
      '@layer theme{:root,:host{--color-sa-dark:#132230}}@layer utilities{.grid{display:grid}}body{color:var(--color-sa-dark)}',
    )
    expect(result.css).toContain('.v1-reference-root')
    expect(result.css).toContain('--color-sa-dark:#132230')
    expect(result.css).toContain('.grid{display:grid}')
    expect(result.css).not.toContain('@layer')
    expect(result.css).not.toMatch(/(?:^|})body\{/)
    expect(result.issues).toContain('cascade-layers-flattened-for-reference')
    const compiled = compileSection({
      sourceHtml: '<div class="v1-reference-root"><section class="grid">Visible source text</section></div>',
      sourceCss: result.css,
      slots: [],
      scopeSelector: sectionScopeSelector('reference')!,
    })
    expect(compiled.blocking).toEqual([])
    expect(compiled.css).toContain('.cms-section--reference .v1-reference-root')
    expect(compiled.css).toContain('.cms-section--reference .grid')
  })
  it('supports authored @theme when a V1 build is unavailable, without rewriting values or class fragments', () => {
    const result = referenceStyles(
      '@theme{--color-sa-dark:#132230}.body-copy{background:url("/images/body.png")}html body p{color:var(--color-sa-dark)}',
    )
    expect(result.css).toContain('.body-copy')
    expect(result.css).toContain('/images/body.png')
    expect(result.css).toContain('.v1-reference-root p')
    expect(result.issues).toContain('theme-tokens-scoped-to-reference')
  })
  it('retains source font declarations for explicit policy review, rather than pretending fonts transferred', () => {
    const result = referenceStyles(
      '@font-face{font-family:Source;src:url("/fonts/source.woff2")}body{font-family:Source,serif}',
    )
    expect(result.css).toContain('@font-face')
    expect(result.css).toContain('/fonts/source.woff2')
  })
  it('bounds Echelon’s source hero span on mobile while retaining desktop max-content sizing', () => {
    const source = '.hero h1 span{width:max-content}'
    const result = referenceStyles(source, { wrapHeroSubtitle: true })
    expect(result.css).toContain('.hero h1 span{width:max-content}')
    expect(result.css).toContain('@media(max-width:767px)')
    expect(result.css).toContain('max-width:100%')
    expect(result.issues).toContain('hero-subtitle-wrap-for-mobile')
    expect(referenceStyles(source).issues).not.toContain('hero-subtitle-wrap-for-mobile')
  })
  it('uses the source inverse-button dark token for its registration status label', () => {
    const result = referenceStyles('.registration-status{color:white}', { readableRegistrationStatus: true })
    expect(result.css).toContain(
      '.v1-reference-root .register-section .registration-status{color:var(--btn-fill,var(--red-deep))}',
    )
    expect(result.issues).toContain('registration-status-contrast-preserved')
  })
  it('maps authored decorative image intent to the same representation readiness expects', () => {
    const source = inertReference('<section><h1>Heading</h1><img src="/images/a.png" alt=""></section>')
    expect(source.html).toContain('role="presentation"')
    const report = runReadinessChecks({
      title: 'Title',
      metaDescription: 'Description',
      html: source.html,
      sectionCount: 1,
      knownPaths: new Set(['/']),
    })
    expect(report.findings.some(finding => finding.rule === 'image_without_alt')).toBe(false)
  })
})
