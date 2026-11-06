import { expect, it } from 'vitest'
import { ButtonAppearance, DEFAULT_BUTTON_APPEARANCE } from '@cms/schema'
import { buttonAppearanceClasses, buttonAppearanceCss } from './button-appearance.ts'
import { renderStructuredField } from './structured.ts'
import { renderSection } from './render.ts'
import { SEED_SECTION_DEFS, seedSectionDefView } from '../../seeds/src/index.ts'

it('keeps original links byte-identical until a complete appearance is chosen', () => {
  const node = { type: 'link', field: 'action' } as const
  const value = { label: 'Read more', url: '/help' }
  expect(renderStructuredField(node, { action: value })).toBe('<a href="/help">Read more</a>')
  const styled = renderStructuredField(node, { action: { ...value, buttonAppearance: DEFAULT_BUTTON_APPEARANCE } })
  expect(styled).toContain('cms-button-style-solid')
  expect(styled).toContain('href="/help"')
  expect(styled).toContain('Read more</a>')
})

it('styles the legacy button and preserves structured definition attributes', () => {
  const cta = seedSectionDefView(SEED_SECTION_DEFS.find(def => def.slug === 'cta')!)
  const buttonAppearance = { ...DEFAULT_BUTTON_APPEARANCE, style: 'outline', color: 'accent', hover: 'invert' }
  expect(
    renderSection(
      {
        def: cta,
        instance: {
          section_def_id: cta.section_def_id,
          section_def_version: cta.version,
          values: { heading: 'Contact us', action: { label: 'Contact', url: '/contact', buttonAppearance } },
        },
      },
      0,
    ),
  ).toContain('cms-button-style-outline')
  expect(
    renderStructuredField(
      { type: 'link', field: 'action', staticAttributes: { class: ['existing'], target: '_blank' } },
      { action: { label: 'Contact', url: '/contact', buttonAppearance } },
    ),
  ).toContain('class="existing cms-button')
})

it('refuses incomplete choices and syntax instead of interpolating it into classes or styles', () => {
  for (const value of [
    {},
    { style: 'outline' },
    { ...DEFAULT_BUTTON_APPEARANCE, color: 'red;display:none' },
    { ...DEFAULT_BUTTON_APPEARANCE, radius: '999rem' },
    { ...DEFAULT_BUTTON_APPEARANCE, extra: 'value' },
    null,
  ]) {
    expect(ButtonAppearance.safeParse(value).success).toBe(false)
    expect(buttonAppearanceClasses(value)).toBe('')
  }
  expect(buttonAppearanceCss({ primary: '</style><script>bad()</script>' })).not.toContain('<script>')
})

it('uses actual opaque contrast pairs, limits styles to the selected actions, and respects reduced motion', () => {
  const css = buttonAppearanceCss({ primary: '#123456', primaryContrast: '#ffffff' })
  expect(css).toContain('cms-button-style-solid{background:#123456!important;color:#ffffff!important')
  expect(css).toContain('cms-button-style-outline{background:#ffffff!important;color:#123456!important')
  expect(css).not.toContain('background:transparent')
  expect(css).toContain('#cms-main a.cms-button-instance')
  expect(css).toContain('prefers-reduced-motion:reduce')
  expect(css).toContain(':focus-visible')
})

it('adds size, label weight and width only when chosen, and refuses anything else', () => {
  expect(buttonAppearanceClasses(DEFAULT_BUTTON_APPEARANCE)).not.toMatch(/size|weight|width/)
  expect(
    buttonAppearanceClasses({ ...DEFAULT_BUTTON_APPEARANCE, size: 'medium', weight: 'bold', width: 'auto' }),
  ).not.toMatch(/size|weight|width/)
  expect(
    buttonAppearanceClasses({ ...DEFAULT_BUTTON_APPEARANCE, size: 'large', weight: 'regular', width: 'full' }),
  ).toMatch(/ cms-button-size-large cms-button-weight-regular cms-button-width-full$/)
  for (const value of [
    { ...DEFAULT_BUTTON_APPEARANCE, size: 'huge' },
    { ...DEFAULT_BUTTON_APPEARANCE, width: '100%' },
    { ...DEFAULT_BUTTON_APPEARANCE, weight: 900 },
  ]) {
    expect(ButtonAppearance.safeParse(value).success).toBe(false)
    expect(buttonAppearanceClasses(value)).toBe('')
  }
  const css = buttonAppearanceCss()
  expect(css).toContain('a.cms-button-instance.cms-button-size-large{padding:.85rem 1.4rem!important')
  expect(css).toContain('a.cms-button-instance.cms-button-width-full{display:flex!important;width:100%!important')
})
