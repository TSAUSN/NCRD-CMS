import { expect, it } from 'vitest'
import { siteSocialSectionValues } from './site-social.ts'
const slots = [{ id: 'accounts_from', kind: 'text', label: 'Links from', constraints: { siteSocialAccounts: true } }]
it('site-owned account projection clears only inactive link samples and preserves manual chapter links', () => {
  const values = {
      heading: '[Heading]',
      accounts_from: 'site',
      links: { items: ['i1'] },
      links__i1__action: { url: '#old', label: '[Old sample]' },
      __cms_sample_fields: ['heading', 'links', 'links__i1__action'],
    },
    settings = {
      schemaVersion: 1,
      name: '[Site]',
      social: [{ service: 'instagram', url: 'https://instagram.com/account/', handle: '@account', inFooter: false }],
    }
  const projected = siteSocialSectionValues(values, slots, 'core-on-page-navigation', settings)
  expect(projected).toMatchObject({
    heading: '[Heading]',
    links: { items: ['s0'] },
    links__s0__action: { url: 'https://instagram.com/account/', label: 'Instagram' },
    __cms_sample_fields: ['heading'],
  })
  expect(projected).not.toHaveProperty('links__i1__action')
  expect(
    siteSocialSectionValues({ ...values, accounts_from: 'own' }, slots, 'core-on-page-navigation', settings).links,
  ).toEqual(values.links)
  expect(siteSocialSectionValues(values, [], 'core-on-page-navigation', settings)).toBe(values)
  expect(siteSocialSectionValues(values, slots, 'chapter-social', settings)).toBe(values)
  expect(siteSocialSectionValues(values, slots, 'core-on-page-navigation', undefined).links).toEqual({ items: [] })
})

it('Echelon Follow opts in to site accounts without persisting projection or a chapter sample note', () => {
  const values = {
      heading: 'Follow our chapter',
      sample_note: 'Sample social links',
      accounts_from: 'site',
      links: { items: ['i1'] },
      links__i1__action: { label: '[Manual]', url: '#manual' },
      __cms_sample_fields: ['sample_note', 'links', 'links__i1__action'],
    },
    settings = {
      schemaVersion: 1,
      name: '[Site]',
      social: [{ service: 'instagram', url: 'https://instagram.com/chapter/', handle: '', inFooter: false }],
    }
  expect(siteSocialSectionValues(values, slots, 'core-echelon-follow', settings)).toMatchObject({
    sample_note: '',
    links: { items: ['s0'] },
    links__s0__action: { label: 'Instagram', url: 'https://instagram.com/chapter/' },
  })
  expect(values.sample_note).toBe('Sample social links')
  expect(
    siteSocialSectionValues({ ...values, accounts_from: 'own' }, slots, 'core-echelon-follow', settings).links,
  ).toEqual(values.links)
})

it('national social accounts update their own group while preserving page jump links', () => {
  const fields = [{ ...slots[0]!, constraints: { siteSocialAccounts: true, siteSocialGroup: 'social' } }],
    values = {
      accounts_from: 'site',
      links: { items: ['who'] },
      links__who__action: { label: 'Who we are', url: '#who' },
      social: { items: ['old'] },
      social__old__action: { label: '[Old account]', url: '#old' },
      __cms_sample_fields: ['social', 'social__old__action'],
    },
    settings = {
      schemaVersion: 1,
      name: '[Site]',
      social: [{ service: 'facebook', url: 'https://facebook.com/account/', handle: '', inFooter: false }],
    }
  const result = siteSocialSectionValues(values, fields, 'core-echelon-jump-links', settings)
  expect(result.links).toEqual(values.links)
  expect(result.links__who__action).toEqual(values.links__who__action)
  expect(result.social).toEqual({ items: ['s0'] })
  expect(result.social__s0__action).toEqual({ label: 'Facebook', url: 'https://facebook.com/account/', newTab: true })
  expect(result).not.toHaveProperty('social__old__action')
  expect(result.__cms_sample_fields).toBeUndefined()
  expect(values.social.items).toEqual(['old'])
  expect(siteSocialSectionValues(values, fields, 'core-echelon-jump-links', undefined).links).toEqual(values.links)
})
