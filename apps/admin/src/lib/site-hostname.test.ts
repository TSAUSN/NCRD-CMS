import { expect, it } from 'vitest'
import { stagingHostnameFor } from './site-creation.ts'

it('allocates stable, separate Google addresses for long site names without a wildcard domain', () => {
  const env = { NODE_ENV: 'production', STAGING_BASE_DOMAIN: 'web.app', FIREBASE_HOSTING_SITE_PREFIX: 'c123456789012' }
  const first = stagingHostnameFor('a-long-event-name-that-uses-the-full-limit', env)!
  const second = stagingHostnameFor('a-long-event-name-that-is-also-different', env)!
  expect(first).toMatch(/^c123456789012-[a-f0-9]{16}\.web\.app$/)
  expect(first.split('.')[0]!.length).toBeLessThanOrEqual(30)
  expect(first).not.toBe(second)
  expect(stagingHostnameFor('a-long-event-name-that-uses-the-full-limit', env)).toBe(first)
  expect(stagingHostnameFor('event', { ...env, FIREBASE_HOSTING_SITE_PREFIX: 'invalid/prefix' })).toBeNull()
  expect(stagingHostnameFor('event', { NODE_ENV: 'test' })).toBe('event.staging.localhost')
})
