import { expect, it } from 'vitest'
import { publicSiteOrigin } from './public-site-url.ts'

it('uses HTTPS without a development port on hosted builds', () => {
  expect(publicSiteOrigin('site.example.test', { NODE_ENV: 'production' })).toBe('https://site.example.test')
})
it('uses the configured public-app port in built-app tests', () => {
  expect(
    publicSiteOrigin('demo.staging.localhost', {
      NODE_ENV: 'production',
      CMS_LOCAL_TEST_MODE: 'true',
      PUBLIC_SITE_PORT: '3201',
    }),
  ).toBe('http://demo.staging.localhost:3201')
})
it('does not turn a malformed stored host into a link', () => {
  expect(publicSiteOrigin('site.example.test@attacker.test')).toBeNull()
  expect(publicSiteOrigin('site.example.test/path')).toBeNull()
  expect(publicSiteOrigin(null)).toBeNull()
})
