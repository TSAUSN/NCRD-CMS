import { DomainError, type DomainErrorKind } from '@cms/domain'
import { expect, it, vi } from 'vitest'
import { createCanvasTicketHandler } from './canvas-ticket-handler.ts'
const id = '11111111-1111-4111-8111-111111111111',
  token = 'a'.repeat(64)
const input = {
  action: 'open',
  versionId: id,
  sitePreview: 'draft',
  channel: 'canvas-channel-123456',
  showHidden: false,
}
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3200/api/pages/' + id + '/canvas', {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3200',
      origin: 'http://127.0.0.1:3200',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
const deps = () => ({
  session: vi.fn(async () => ({ userId: 'actor' })),
  open: vi.fn(async () => ({
    href: 'http://site.staging.localhost:3201/__cms/canvas/' + token,
    token,
    expiresAt: 'later',
  })),
  renew: vi.fn(async () => ({ expiresAt: 'later' })),
})
it('requires verified same-origin/session and bounded closed input before issuance', async () => {
  const d = deps(),
    handle = createCanvasTicketHandler(d)
  expect((await handle(request(input, { origin: 'https://evil.test' }), id)).status).toBe(403)
  expect(d.session).not.toHaveBeenCalled()
  expect((await handle(request(input, { 'sec-fetch-site': 'cross-site' }), id)).status).toBe(403)
  for (const body of [
    { ...input, html: '<script>' },
    { ...input, channel: 'short' },
    { ...input, versionId: 'foreign' },
    { action: 'renew', token: 'bad' },
    Array(5000).fill('x'),
  ])
    expect((await handle(request(body), id)).status).toBe(400)
  expect(d.open).not.toHaveBeenCalled()
  expect(d.renew).not.toHaveBeenCalled()
  expect((await createCanvasTicketHandler({ ...d, session: async () => null })(request(), id)).status).toBe(404)
  const response = await handle(request(), id)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(d.open).toHaveBeenCalledWith('actor', id, {
    versionId: id,
    sitePreview: 'draft',
    channel: input.channel,
    showHidden: false,
    parentOrigin: 'http://127.0.0.1:3200',
  })
  expect((await handle(request({ action: 'renew', token }), id)).status).toBe(200)
  expect(d.renew).toHaveBeenCalledWith('actor', id, token)
})
it('does not expose database details and preserves conflict/refusal distinctions', async () => {
  for (const [code, kind, status] of [
    ['CMS01', 'stale_revision', 409],
    ['CMS02', 'not_authorized', 404],
    ['CMS03', 'not_found', 404],
    ['XX000', null, 503],
  ] as const) {
    for (const error of [
      Object.assign(Error('private database detail'), { code }),
      ...(kind ? [new DomainError(kind as DomainErrorKind, 'private database detail')] : []),
    ]) {
      const response = await createCanvasTicketHandler({
        ...deps(),
        open: async () => {
          throw error
        },
      })(request(), id)
      expect(response.status).toBe(status)
      expect(await response.text()).not.toContain('private database detail')
    }
  }
})
