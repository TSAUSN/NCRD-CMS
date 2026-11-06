// Host handling is a tenant boundary, so the hostile cases are the point
// (SPEC §8, §9): anything that could make two different requests resolve to
// the same site must be refused, not normalized into a match.
import { describe, expect, it } from 'vitest'
import { normalizeHost, normalizePath, stripWww } from './hostname.ts'

describe('normalizeHost', () => {
  it('lowercases and strips a port and trailing dot', () => {
    expect(normalizeHost('Example.COM:8080')).toBe('example.com')
    expect(normalizeHost('example.com.')).toBe('example.com')
    expect(normalizeHost('  Site-A.Staging.Example.Test  ')).toBe('site-a.staging.example.test')
  })

  it.each([
    ['empty', ''],
    ['a path', 'example.com/admin'],
    ['userinfo', 'user@example.com'],
    ['two hosts', 'example.com evil.com'],
    ['an IPv6 literal', '[::1]'],
    ['a non-numeric port', 'example.com:abc'],
    ['an underscore label', 'bad_host.example.com'],
    ['a leading hyphen', '-bad.example.com'],
    ['a non-ASCII host', 'exämple.com'],
    ['an empty label', 'a..b.com'],
  ])('refuses %s rather than coercing it', (_name, input) => {
    expect(normalizeHost(input)).toBeNull()
  })

  it('refuses null and undefined', () => {
    expect(normalizeHost(null)).toBeNull()
    expect(normalizeHost(undefined)).toBeNull()
  })

  it('strips www for the apex redirect', () => {
    expect(stripWww('www.example.com')).toBe('example.com')
    expect(stripWww('example.com')).toBe('example.com')
  })
})

describe('normalizePath', () => {
  it('produces the shape published_routes stores', () => {
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('')).toBe('/')
    expect(normalizePath('about')).toBe('/about')
    expect(normalizePath('/About/')).toBe('/about')
    expect(normalizePath('/a/b/?x=1#y')).toBe('/a/b')
  })

  it('collapses repeated trailing slashes so /x/// cannot be a second route', () => {
    expect(normalizePath('/x///')).toBe('/x')
  })
})
