import { expect, it } from 'vitest'
import { SlotDef } from '@cms/schema'
import { carryFrameValues, frameLogoPreset } from './frame-field-values.ts'
const slot = (id: string, kind: string, constraints = {}) => SlotDef.parse({ id, kind, label: id, constraints })
it('carries only fields whose ID and kind survive, never menu data or renamed/removed fields', () => {
  const source = [slot('title', 'text'), slot('body', 'richtext'), slot('action', 'text'), slot('removed', 'text')]
  const target = [slot('title', 'text'), slot('body', 'richtext'), slot('action', 'link'), slot('menu', 'navigation')]
  expect(
    carryFrameValues(
      { title: 'Title', body: '<p>Copy</p>', action: 'Words', removed: 'Old', menu: 'unsafe' },
      target,
      source,
    ),
  ).toEqual({ title: 'Title', body: '<p>Copy</p>' })
})
it('does not carry an unconstrained text value into a constrained icon field', () => {
  expect(
    carryFrameValues(
      { icon: 'free text' },
      [slot('icon', 'text', { presentation: 'cms-line-icons-v1' })],
      [slot('icon', 'text')],
    ),
  ).toEqual({})
})
it('never changes the previous immutable values or carries unknown fields without a source declaration', () => {
  const values = { title: 'Old', extra: 'Private' }
  expect(carryFrameValues(values, [slot('title', 'text')], [])).toEqual({})
  expect(values).toEqual({ title: 'Old', extra: 'Private' })
})
it('does not mistake inherited object properties for saved content', () => {
  const fields = [slot('toString', 'text')]
  expect(carryFrameValues({}, fields, fields)).toEqual({})
})
it('keeps the shared labelled-link shape when a button becomes a link', () => {
  const values = { cta: { label: 'More', url: '/more' } }
  expect(carryFrameValues(values, [slot('cta', 'link')], [slot('cta', 'button')])).toEqual(values)
})
it('does not carry collection bindings even if a legacy definition declared them', () => {
  const fields = [slot('items', 'repeat')]
  expect(carryFrameValues({ items: { collection_id: 'old' } }, fields, fields)).toEqual({})
})

it('adds the approved initial site logo on upgrade and never replaces an existing choice', () => {
  const logo = { src: '/cms-themes/sawso/salvation-army-shield.svg', alt: 'The Salvation Army', decorative: false },
    field = slot('logo', 'image', { siteLogo: true, sourceSample: logo })
  expect(carryFrameValues({ title: 'Keep' }, [slot('title', 'text'), field], [slot('title', 'text')])).toEqual({
    title: 'Keep',
    logo,
  })
  const own = { src: '/media/own/original', alt: 'Own logo', decorative: false }
  expect(carryFrameValues({ logo: own }, [field], [field])).toEqual({ logo: own })
})

it('offers the pinned component’s valid logo preset only for a declared logo field', () => {
  const value = { src: '/default-logo.svg', alt: 'Organization', decorative: false }
  expect(frameLogoPreset(slot('brand-image', 'image', { siteLogo: true, sourceSample: value }))).toEqual({
    label: 'Use the default logo',
    value,
  })
  expect(
    frameLogoPreset(slot('brand-image', 'image', { siteLogo: true, sourceSample: { ...value, alt: '' } })),
  ).toBeNull()
  expect(frameLogoPreset(slot('brand-image', 'image', { sourceSample: value }))).toBeNull()
  expect(frameLogoPreset(slot('brand-image', 'image', { siteLogo: true }))).toBeNull()
})

it('leaves an inherited footer logo absent on upgrade, while preserving an existing custom image', () => {
  const field = slot('logo', 'image', {
    siteLogo: true,
    inheritHeaderLogo: true,
    sourceSample: { src: '/fallback.png', alt: 'Fallback' },
  })
  expect(carryFrameValues({}, [field], [])).toEqual({})
  const own = { logo: { src: '/own.png', alt: 'Own' } }
  expect(carryFrameValues(own, [field], [field])).toEqual(own)
})
