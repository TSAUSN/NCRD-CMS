import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { REFRESH_COOKIE, HOSTED_SESSION_COOKIE as SESSION_COOKIE, type AuthProvider } from '@cms/platform'
import { needsSessionRenewal, renewSession } from './session-renewal.ts'

const jwt = (exp: unknown) => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
const request = (token?: string) =>
  new NextRequest('https://cms.example.test/pages/one', {
    headers: { cookie: `${REFRESH_COOKIE}=old-refresh${token ? `; ${SESSION_COOKIE}=${token}` : ''}` },
  })

describe('session renewal transport', () => {
  it('renews missing, expired and malformed tokens but leaves distant expiry to the real verifier', () => {
    expect(needsSessionRenewal(undefined, 100_000)).toBe(true)
    expect(needsSessionRenewal(jwt(120), 100_000)).toBe(true)
    expect(needsSessionRenewal('malformed', 100_000)).toBe(true)
    expect(needsSessionRenewal(jwt(3600), 100_000)).toBe(false)
  })
  it('rotates request and browser cookies together, with HTTP-only secure settings', async () => {
    const refresh = vi.fn().mockResolvedValue({
      token: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 300,
      subject: { subject: 'user', email: 'verified@example.test' },
    })
    const incoming = request()
    const response = await renewSession(incoming, { name: 'test', refresh, verify: vi.fn() } as AuthProvider)
    expect(incoming.cookies.get(SESSION_COOKIE)?.value).toBe('new-access')
    expect(response.cookies.get(REFRESH_COOKIE)).toMatchObject({
      value: 'new-refresh',
      httpOnly: true,
      secure: true,
      path: '/',
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('cookie')).toBeNull()
  })
  it('clears both credentials when renewal is definitively refused', async () => {
    const incoming = request('expired')
    const response = await renewSession(incoming, {
      name: 'test',
      verify: vi.fn(),
      refresh: vi.fn().mockResolvedValue(null),
    })
    expect(incoming.cookies.has(SESSION_COOKIE)).toBe(false)
    expect(incoming.cookies.has(REFRESH_COOKIE)).toBe(false)
    expect(response.cookies.get(REFRESH_COOKIE)?.maxAge).toBe(0)
  })
  it('does not erase a recoverable session during a provider outage', async () => {
    const incoming = request('expired')
    const response = await renewSession(incoming, {
      name: 'test',
      verify: vi.fn(),
      refresh: vi.fn().mockRejectedValue(new Error('offline')),
    })
    expect(incoming.cookies.get(REFRESH_COOKIE)?.value).toBe('old-refresh')
    expect(response.cookies.getAll()).toEqual([])
  })
})
