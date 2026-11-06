import { describe, expect, it } from 'vitest'
import { adminContentSecurityPolicy, contentPolicyNonce, hasOwnContentPolicy } from './content-security.ts'

describe('admin content security policy (AUTH-05)', () => {
  it('lets only nonce-bearing scripts run, keeps ordinary resources on this origin and refuses other framers', () => {
    const policy = adminContentSecurityPolicy('abc123')
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'")
    expect(policy).not.toContain('unsafe-eval')
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/)
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ]) {
      expect(policy).toContain(directive)
    }
    expect(adminContentSecurityPolicy('n', true)).toContain("'unsafe-eval'")
  })
  it('allows only one exact validated canvas origin without widening script or connection policy', () => {
    const policy = adminContentSecurityPolicy('n', false, 'http://own.staging.localhost:3201')
    expect(policy).toContain("frame-src 'self' http://own.staging.localhost:3201")
    expect(policy).toContain("connect-src 'self'")
    for (const origin of [
      'https://evil.test; script-src *',
      'javascript:bad()',
      'https://user:pass@evil.test',
      'https://evil.test/path',
    ]) {
      expect(adminContentSecurityPolicy('n', false, origin)).toBe(adminContentSecurityPolicy('n'))
    }
  })
  it('leaves routes that send their own policy alone and covers every page', () => {
    for (const path of [
      '/preview/v',
      '/releases/r/preview/p',
      '/api/inbox/summary',
      '/media/a/b',
      '/assets/x',
      '/health',
    ])
      expect(hasOwnContentPolicy(path)).toBe(true)
    for (const path of ['/', '/pages/p', '/sites/s/design', '/sign-in', '/previews-are-not-a-route'])
      expect(hasOwnContentPolicy(path)).toBe(false)
  })
  it('makes a fresh, unguessable nonce for every request', () => {
    const nonces = new Set(Array.from({ length: 50 }, contentPolicyNonce))
    expect(nonces.size).toBe(50)
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/=]{40,}$/)
  })
})

it('allows only fixed Adobe resource hosts for inherited private previews, never scripts or connections', () => {
  const policy = adminContentSecurityPolicy('test')
  expect(policy).toContain("style-src 'self' 'unsafe-inline' https://use.typekit.net https://p.typekit.net")
  expect(policy).toContain("font-src 'self' data: https://use.typekit.net")
  expect(policy).toContain("img-src 'self' data: blob: https://p.typekit.net")
  for (const directive of policy
    .split('; ')
    .filter(part => part.startsWith('script-src ') || part.startsWith('connect-src ')))
    expect(directive).not.toContain('typekit.net')
  expect(policy).not.toContain('*.typekit.net')
  expect(policy).not.toContain('performance.typekit.net')
})
