import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { googleAnalyticsBootstrap, googleAnalyticsScriptHash } from './google-analytics.ts'
it('hashes the exact bootstrap and configures one site without URL query data or advertising signals', () => {
  const script = googleAnalyticsBootstrap('G-ABCD123456')
  expect(googleAnalyticsScriptHash('G-ABCD123456')).toBe(
    'sha256-' + createHash('sha256').update(script).digest('base64'),
  )
  const context: Record<string, unknown> = {
    location: { origin: 'https://site.example.test', pathname: '/news', search: '?private=value' },
  }
  context.window = context
  runInNewContext(script, context)
  const events = (context.dataLayer as IArguments[]).map(args => Array.from(args))
  expect(events).toHaveLength(2)
  expect(events[1]).toEqual([
    'config',
    'G-ABCD123456',
    {
      page_location: 'https://site.example.test/news',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    },
  ])
  expect(() => googleAnalyticsBootstrap('G-ABCD\"><script>')).toThrow('Invalid')
})
