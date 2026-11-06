import { readFile } from 'node:fs/promises'
import { it, expect, vi } from 'vitest'
import { LOCAL_BRAND_FONTS } from '@cms/renderer'
import { serveLocalBrandFont } from './local-brand-font-handler.ts'
const request = (host = 'sample.staging.localhost') =>
  new Request('http://' + host + '/__cms/fonts/file', { headers: { host } })
it('self-hosts the seven approved exact files only on local hosts and refuses changed bytes', async () => {
  for (const font of LOCAL_BRAND_FONTS) {
    const data = await readFile(new URL('./assets/creato-display/' + font.source, import.meta.url))
    expect(data.subarray(0, 4).toString()).toBe('wOF2')
    const response = await serveLocalBrandFont(request(), font.file, { local: true, read: async () => data })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('font/woff2')
    expect((await response.arrayBuffer()).byteLength).toBe(font.bytes)
  }
  expect(
    (
      await serveLocalBrandFont(request(), LOCAL_BRAND_FONTS[0]!.file, {
        local: true,
        read: async () => new Uint8Array([1]),
      })
    ).status,
  ).toBe(404)
})
it('does not read assets for hosted mode, a public domain or an unapproved path', async () => {
  const read = vi.fn(async () => new Uint8Array())
  for (const [host, file, local] of [
    ['sample.staging.localhost', LOCAL_BRAND_FONTS[0]!.file, false],
    ['example.org', LOCAL_BRAND_FONTS[0]!.file, true],
    ['sample.staging.localhost', '../../secret', true],
  ] as const)
    expect((await serveLocalBrandFont(request(host), file, { local, read })).status).toBe(404)
  expect(read).not.toHaveBeenCalled()
})

it('supports HEAD without a body and refuses unavailable bytes', async () => {
  const file = LOCAL_BRAND_FONTS[0]!,
    data = await readFile(new URL('./assets/creato-display/' + file.source, import.meta.url))
  const response = await serveLocalBrandFont(new Request(request(), { method: 'HEAD' }), file.file, {
    local: true,
    read: async () => data,
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('etag')).toBe('"' + file.sha256 + '"')
  expect(await response.text()).toBe('')
  const missing = await serveLocalBrandFont(request(), file.file, {
    local: true,
    read: async () => {
      throw new Error('unavailable')
    },
  })
  expect(missing.status).toBe(404)
  expect(missing.headers.get('cache-control')).toBe('no-store')
})

it('requires explicit licensed-hosting opt-in and serves only the same exact seven font bytes', async () => {
  for (const font of LOCAL_BRAND_FONTS) {
    const data = await readFile(new URL('./assets/creato-display/' + font.source, import.meta.url))
    const response = await serveLocalBrandFont(request('review.web.app'), font.file, {
      local: false,
      publicHosting: true,
      read: async () => data,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"' + font.sha256 + '"')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(data))
  }
  const read = vi.fn(async () => new Uint8Array())
  expect(
    (await serveLocalBrandFont(request('review.web.app'), '../../private', { local: false, publicHosting: true, read }))
      .status,
  ).toBe(404)
  expect(read).not.toHaveBeenCalled()
  expect(
    (
      await serveLocalBrandFont(request('review.web.app'), LOCAL_BRAND_FONTS[0]!.file, {
        local: false,
        publicHosting: true,
        read: async () => new Uint8Array([1]),
      })
    ).status,
  ).toBe(404)
})
