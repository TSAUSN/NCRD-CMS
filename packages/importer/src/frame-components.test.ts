import { describe, expect, it } from 'vitest'
import { frameComponent, sourceFooterFrame, sourceHeaderFrame } from './frame-components.ts'

const index = `<!doctype html><html><body>
<header id="site-header" class="fixed top-0 left-0 right-0 z-50 bg-white transition-shadow duration-300">
  <div class="border-b"><div class="max-w-6xl mx-auto flex items-center justify-between">
    <a href="/" class="flex items-center gap-6" aria-label="Home">
      <img src="/images/shield.png" alt="The Salvation Army" class="h-11" data-block-id="site-header-shield" data-editable="image">
      <span class="font-bold" data-block-id="site-header-title" data-editable="text">Human Needs Index</span>
    </a>
    <div class="hidden sm:flex items-center gap-3"><span>In partnership with</span>
      <a href="https://partner.example/" target="_blank" rel="noopener noreferrer"><img src="/images/partner.png" alt="Partner" data-editable="image" data-block-id="partner"></a></div>
    <button id="mobile-menu-toggle" type="button" class="sm:hidden p-2" aria-expanded="false" aria-controls="mobile-menu" aria-label="Toggle navigation"><svg class="w-5 h-5" viewBox="0 0 24 24"><path d="M4 6h16"/></svg></button>
  </div></div>
  <div class="hidden sm:block"><div class="max-w-6xl mx-auto"><nav aria-label="Main navigation" class="flex justify-center"><div class="flex items-center gap-10">
    <a href="#home" class="nav-pill">Home</a><a href="/methodology.html" class="nav-pill">Methodology</a>
  </div></nav></div></div>
  <nav id="mobile-menu" class="hidden sm:hidden bg-white px-6" aria-label="Mobile navigation"><a href="#home" class="block">Home</a></nav>
</header>
<main></main>
<footer id="footer" class="bg-sa-dark text-white pt-20">
  <h3 data-block-id="footer-navigate" data-editable="text" class="uppercase">Navigate</h3>
  <a href="/methodology.html" class="footer-link" data-block-id="footer-link-methodology" data-editable="link">Methodology</a>
  <div class="relative" id="contact-trigger">
    <button type="button" id="contact-btn" class="flex items-center" aria-label="View contact information" aria-expanded="false" aria-controls="contact-popup"><span>Contact Information</span></button>
    <div id="contact-popup" class="absolute bottom-full right-0 w-80 hidden"><div class="bg-white">
      <div data-block-id="contact-1" data-editable="richtext"><p>Jordan Example</p><a href="tel:5555550100" class="block">555-555-0100</a><a href="mailto:jordan@example.org">jordan@example.org</a></div>
    </div></div>
  </div>
  <p data-block-id="footer-copy" data-editable="richtext">&copy; <span id="footer-year"></span> The Salvation Army. All rights reserved.</p>
</footer></body></html>`

const css =
  '.flex{display:flex}.hidden{display:none}.bg-white{background-color:#fff}.bg-sa-dark{background:#132230}.nav-pill{color:red}.fixed{position:fixed}' +
  '@font-face{font-family:X;src:url("/fonts/x.otf")}@media (width>=40rem){.sm\\:flex{display:flex}.sm\\:hidden{display:none}}'
const assets = new Map([
  [
    '/images/shield.png',
    { mediaId: '11111111-1111-4111-8111-111111111111', url: '/media/11111111-1111-4111-8111-111111111111/original' },
  ],
  [
    '/images/partner.png',
    { mediaId: '22222222-2222-4222-8222-222222222222', url: '/media/22222222-2222-4222-8222-222222222222/original' },
  ],
])
const links = new Map([['/methodology.html', '/methodology']])

describe('source header frame', () => {
  const frame = sourceHeaderFrame(index)

  it('keeps the brand bar and partner identity, drops fixed positioning and every script-driven control', () => {
    expect(frame.html).toContain('<div class="v1-reference-root hni-frame"><div class="bg-white">')
    expect(frame.html).not.toMatch(/\bfixed\b|z-50/)
    expect(frame.html).toContain('In partnership with')
    expect(frame.html).not.toContain('<button')
    expect(frame.html).toContain('<details class="hni-mobile-menu sm:hidden"><summary')
    expect(frame.html).not.toContain('nav-pill')
    expect(frame.issues).toContain('frame-menu-from-site-navigation')
  })

  it('compiles with the source fields plus one site menu used twice, and no font files', () => {
    const component = frameComponent({ slug: 'frame-header', frame, builtCss: css, assets, links })
    expect(component.slots.map(slot => slot.kind)).toEqual(['image', 'text', 'image', 'navigation'])
    expect(component.sourceHtml.match(/\{\{site-menu\}\}/g)).toHaveLength(2)
    expect(component.compiled.blocking).toEqual([])
    expect(component.compiled.carriesTrustedCode).toBe(false)
    expect(component.sourceCss).not.toContain('@font-face')
    expect(component.sourceCss).not.toContain('.fixed{')
    const image = Object.values(component.values).find(
      value => (value as { media_id?: string }).media_id === '11111111-1111-4111-8111-111111111111',
    )
    expect(image).toMatchObject({
      src: '/media/11111111-1111-4111-8111-111111111111/original',
      alt: 'The Salvation Army',
    })
  })

  it('makes nested navigation reachable with pointer, keyboard, and the phone menu', () => {
    expect(frame.css).toContain(
      '.hni-frame .cms-nav-item:hover>.cms-nav-submenu,.hni-frame .cms-nav-item:focus-within>.cms-nav-submenu{display:block}',
    )
    expect(frame.css).toContain('.hni-frame .hni-mobile-menu .cms-nav-submenu{display:block;position:static')
    expect(frame.css).toContain('.hni-frame .cms-nav-submenu .cms-nav-submenu{left:100%;top:0}')
  })
})

describe('source footer frame', () => {
  const frame = sourceFooterFrame(index, 2031)

  it('turns the scripted contact pop-out into a disclosure and fixes the year', () => {
    expect(frame.html).toContain('<details class="relative hni-contact"><summary')
    expect(frame.html).not.toContain('<button')
    expect(frame.html).not.toContain('contact-popup')
    expect(frame.html).not.toMatch(/class="[^"]*\bhidden\b/)
    expect(frame.html).toContain('2031 The Salvation Army')
    expect(frame.html).toContain('data-cms-label="Contact phone"')
    // On phones the panel opens from the trigger's left edge instead of off-screen.
    expect(frame.css).toContain('@media(max-width:639px){.hni-frame .hni-contact>summary+div{left:0;right:auto}}')
  })

  it('compiles with its links mapped to working pages', () => {
    const component = frameComponent({ slug: 'frame-footer', frame, builtCss: css, assets, links })
    expect(component.compiled.blocking).toEqual([])
    expect(component.slots.some(slot => slot.kind === 'navigation')).toBe(false)
    expect(JSON.stringify(component.values)).toContain('/methodology')
    expect(JSON.stringify(component.values)).not.toContain('.html')
  })
})

it('refuses a frame that references files not transferred to Media', () => {
  expect(() =>
    frameComponent({ slug: 'frame-missing', frame: sourceHeaderFrame(index), builtCss: css, assets: new Map(), links }),
  ).toThrow(/untransferred/)
})
