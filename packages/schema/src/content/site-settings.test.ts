import { expect, it } from 'vitest'
import { SitePublicSettings, parseSiteVerificationTags, formatSiteVerificationTags } from './site-settings.ts'
it('keeps blocks optional and accepts safe site-owned social accounts', () => {
  expect(SitePublicSettings.parse({ schemaVersion: 1, name: '[Site]' })).toEqual({ schemaVersion: 1, name: '[Site]' })
  const account = { service: 'instagram', url: 'https://example.test/account', handle: '@[handle]', inFooter: true }
  expect(
    SitePublicSettings.safeParse({ schemaVersion: 1, name: '[Site]', social: [{ ...account, handle: '@account' }] })
      .success,
  ).toBe(true)
  for (const url of [
    'javascript:alert(1)',
    'http://example.test',
    'https://name:password@example.test',
    'https://example.test/one two',
  ])
    expect(
      SitePublicSettings.safeParse({
        schemaVersion: 1,
        name: '[Site]',
        social: [{ ...account, url, handle: 'account' }],
      }).success,
    ).toBe(false)
  expect(
    SitePublicSettings.safeParse({
      schemaVersion: 1,
      name: '[Site]',
      social: [{ service: 'x', url: '', handle: '', inFooter: true }],
    }).success,
  ).toBe(false)
})
it('accepts only the closed verification names and safe values,in either quoted attribute order', () => {
  const tag = '<meta content="public-token_1=" name="google-site-verification" />',
    parsed = parseSiteVerificationTags(tag)!
  expect(parsed).toEqual([{ name: 'google-site-verification', content: 'public-token_1=' }])
  expect(parseSiteVerificationTags(formatSiteVerificationTags(parsed))).toEqual(parsed)
  for (const text of [
    '<script>alert(1)</script>',
    '<meta http-equiv="refresh" content="0">',
    '<meta name="google-site-verification" content="x" onload="alert(1)">',
    '<meta name="google-site-verification" content="<script>">',
    tag + tag,
  ])
    expect(parseSiteVerificationTags(text)).toBeNull()
})
it('bounds General and Search fields without accepting extra code or analytics properties', () => {
  const general = {
    description: '[Description]',
    country: '[Country]',
    language: 'en',
    email: 'contact@example.test',
    phone: '[Phone]',
    address: '[Address]',
  }
  expect(SitePublicSettings.safeParse({ schemaVersion: 1, name: '[Site]', general }).success).toBe(true)
  expect(
    SitePublicSettings.safeParse({
      schemaVersion: 1,
      name: '[Site]',
      general: { ...general, description: 'x'.repeat(156) },
    }).success,
  ).toBe(false)
  expect(SitePublicSettings.safeParse({ schemaVersion: 1, name: '[Site]', analytics: 'unapproved' }).success).toBe(
    false,
  )
})

it('accepts only typed, opt-in GA4 settings and normalizes the Measurement ID', () => {
  const base = {
    schemaVersion: 1,
    name: 'Site',
    analytics: { measurementId: ' g-abcd123456 ', enabled: true, includeStaging: false },
  }
  expect(SitePublicSettings.parse(base).analytics?.measurementId).toBe('G-ABCD123456')
  expect(
    SitePublicSettings.safeParse({ ...base, analytics: { measurementId: '', enabled: false, includeStaging: false } })
      .success,
  ).toBe(true)
  for (const analytics of [
    { ...base.analytics, measurementId: '', enabled: true },
    { ...base.analytics, measurementId: 'GTM-ABCD1234' },
    { ...base.analytics, measurementId: 'UA-123456-1' },
    { ...base.analytics, measurementId: 'https://example.test/tag.js' },
    { ...base.analytics, measurementId: 'G-ABCD1234\"><script>' },
    { ...base.analytics, extraScript: '<script>bad()</script>' },
    { ...base.analytics, includeStaging: 'true' },
  ])
    expect(SitePublicSettings.safeParse({ ...base, analytics }).success).toBe(false)
})
