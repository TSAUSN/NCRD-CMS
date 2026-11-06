import { expect, it } from 'vitest'
import { FooterConfig, HeaderConfig, SlotDef } from '@cms/schema'
import { inheritFooterLogo } from './frame-logo.ts'
const id = '11111111-1111-4111-8111-111111111111',
  slot = SlotDef.parse({
    id: 'logo',
    kind: 'image',
    label: 'Logo',
    constraints: { siteLogo: true, inheritHeaderLogo: true, sourceSample: { src: '/fallback.png', alt: 'Fallback' } },
  })
const footer = () =>
  FooterConfig.parse({
    schemaVersion: 2,
    enabled: true,
    component: { section_def_id: id, section_def_version: 1, values: { name: 'Keep' } },
  })
const header = HeaderConfig.parse({
  schemaVersion: 2,
  enabled: false,
  sticky: false,
  component: {
    section_def_id: id,
    section_def_version: 1,
    values: { logo: { src: '/media/header/original', alt: 'Header logo' } },
  },
})
it('inherits the current header logo even when its landmark is off, without changing saved values', () => {
  const original = footer()
  if (original.schemaVersion !== 2) throw Error('fixture')
  expect(inheritFooterLogo(original, [slot], header, [slot]).component.values).toEqual({
    name: 'Keep',
    logo: { src: '/media/header/original', alt: 'Header logo' },
  })
  expect(original.component.values).toEqual({ name: 'Keep' })
})
it('keeps a custom footer logo and uses only the opted-in template fallback', () => {
  const original = footer()
  if (original.schemaVersion !== 2) throw Error('fixture')
  const own = { src: '/own.png', alt: 'Own' }
  original.component.values.logo = own
  expect(inheritFooterLogo(original, [slot], header, [slot]).component.values.logo).toEqual(own)
  delete original.component.values.logo
  expect(inheritFooterLogo(original, [slot], null).component.values.logo).toEqual(slot.constraints.sourceSample)
  expect(
    inheritFooterLogo(original, [{ ...slot, constraints: { siteLogo: true } }], header, [slot]).component.values.logo,
  ).toBeUndefined()
})
