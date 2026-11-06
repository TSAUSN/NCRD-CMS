import { expect, it, vi } from 'vitest'
import { canvasFrameOrigin } from './canvas-frame-origin.ts'
const id = '11111111-1111-4111-8111-111111111111'
it('resolves only the verified own-site editor/design origin and fails closed', async () => {
  const deps = {
    user: vi.fn(async () => 'actor'),
    hostname: vi.fn(async () => 'own.staging.localhost'),
    origin: (host: string) => 'http://' + host + ':3201',
  }
  expect(await canvasFrameOrigin('/sign-in', deps)).toBeNull()
  expect(await canvasFrameOrigin('/pages/invalid', deps)).toBeNull()
  expect(deps.user).not.toHaveBeenCalled()
  expect(await canvasFrameOrigin('/pages/' + id, deps)).toBe('http://own.staging.localhost:3201')
  expect(deps.hostname).toHaveBeenLastCalledWith('actor', id, 'page')
  expect(await canvasFrameOrigin('/sites/' + id + '/design', deps)).toBe('http://own.staging.localhost:3201')
  expect(deps.hostname).toHaveBeenLastCalledWith('actor', id, 'site')
  expect(await canvasFrameOrigin('/sites/' + id + '/design/fonts', deps)).toBe('http://own.staging.localhost:3201')
  expect(deps.hostname).toHaveBeenLastCalledWith('actor', id, 'fonts')
  expect(await canvasFrameOrigin('/sites/' + id + '/design/fonts/unknown', deps)).toBeNull()
  expect(await canvasFrameOrigin('/pages/' + id, { ...deps, user: async () => null })).toBeNull()
  expect(await canvasFrameOrigin('/pages/' + id, { ...deps, hostname: async () => null })).toBeNull()
  expect(
    await canvasFrameOrigin('/pages/' + id, {
      ...deps,
      hostname: async () => {
        throw Error('unavailable')
      },
    }),
  ).toBeNull()
})

it('permits the own-site read-only header preview without permitting adjacent routes', async () => {
  const deps = {
    user: async () => 'actor',
    hostname: vi.fn(async () => 'own.staging.localhost'),
    origin: (host: string) => 'http://' + host + ':3201',
  }
  expect(await canvasFrameOrigin('/sites/' + id + '/header', deps)).toBe('http://own.staging.localhost:3201')
  expect(deps.hostname).toHaveBeenLastCalledWith('actor', id, 'fonts')
  expect(await canvasFrameOrigin('/sites/' + id + '/header/unknown', deps)).toBeNull()
})

it('permits only the own-site Footer preview route', async () => {
  const deps = {
    user: async () => 'actor',
    hostname: vi.fn(async () => 'own.staging.localhost'),
    origin: (host: string) => 'http://' + host + ':3201',
  }
  expect(await canvasFrameOrigin('/sites/' + id + '/footer', deps)).toBe('http://own.staging.localhost:3201')
  expect(deps.hostname).toHaveBeenLastCalledWith('actor', id, 'fonts')
  expect(await canvasFrameOrigin('/sites/' + id + '/footer/unknown', deps)).toBeNull()
})
