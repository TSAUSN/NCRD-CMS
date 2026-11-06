import { it, expect } from 'vitest'
import { renderHeroSlides } from './hero-slides.ts'
import { HERO_SLIDES_RUNTIME } from './hero-slides-runtime.ts'
const slot = {
    id: 'slides',
    kind: 'repeat',
    label: 'Slides',
    constraints: { heroSlides: true, heroEditingParity: true },
  },
  html =
    '<div class="cms-hero-slider">' +
    ['i1', 'i2', 'i3']
      .map(
        key =>
          '<article class="national-hero cms-hero-slide"><div class="national-hero-copy"><h2>' +
          key +
          '</h2><span class="cms-hero-main"><a href="/missing">Button</a></span></div></article>',
      )
      .join('') +
    '</div>',
  values = {
    slides: { items: ['i1', 'i2', 'i3'] },
    slides__i1__position: 'right',
    slides__i1__shade: 'white',
    slides__i1__primary_visible: 'off',
    slides__i2__primary: { label: 'Button', url: '/missing' },
    slides__i2__starts_at: '2026-11-01T14:00:00Z',
    slides__i3__enabled: 'off',
  }
it('keeps future slides hidden but available for timed activation and omits switched-off slides and buttons', () => {
  const result = renderHeroSlides(html, 0, slot, values, false, Date.parse('2026-11-01T13:00:00Z'))
  expect(result).toContain('data-cms-hero-windowed="true"')
  expect(result).toContain('data-hero-position="right"')
  expect(result).toContain('data-hero-shade="white"')
  expect(result).toMatch(/data-cms-hero-key="i2"[^>]* hidden/)
  expect(result).not.toContain('data-cms-hero-key="i3"')
  expect(result.match(/href="\/missing"/g)).toHaveLength(1)
  expect(HERO_SLIDES_RUNTIME).toContain('windowedHero(track)')
  expect(HERO_SLIDES_RUNTIME).toContain('window.setInterval(sync,1000)')
  const later = renderHeroSlides(html, 0, slot, values, false, Date.parse('2026-11-01T14:00:00Z'))
  expect(later).toContain('href="#cms-hero-s0-i2"')
  expect(later).not.toMatch(/data-cms-hero-key="i2"[^>]* hidden/)
  const editing = renderHeroSlides(html, 0, slot, values, true)
  expect(editing).toContain('data-cms-hero-key="i3"')
  expect(editing).toContain('data-cms-hero-editing="true"')
})
