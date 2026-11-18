import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { assertVersion, pushDisasterBody, readDisasterItem, zestyConfig, zestyRequest } =
  await import('./zesty-disasters.ts')

const env = {
  ZESTY_INSTANCE_ZUID: '8-abc123-def456',
  ZESTY_API_TOKEN: 'sample-token',
}
const settings = zestyConfig(env)
if (!settings.ok) throw Error('sample settings should be valid')
const config = settings.config
const ITEM = 'https://8-abc123-def456.api.zesty.io/v1/content/models/6-c2b7f2a9ad-k4frxv/items/7-beb69fc0fa-zk6tts'

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('Zesty settings', () => {
  it('names each missing or malformed setting', () => {
    expect(zestyConfig({ ...env, ZESTY_API_TOKEN: '', ZESTY_INSTANCE_ZUID: 'not-a-zuid' })).toEqual({
      ok: false,
      missing: ['ZESTY_INSTANCE_ZUID', 'ZESTY_API_TOKEN'],
    })
  })

  it('cannot be pointed at another page through settings', () => {
    const other = zestyConfig({ ...env, ZESTY_DISASTERS_ITEM_ZUID: '7-aaaaaaaaaa-other', ZESTY_ITEM_ZUID: '7-x-y' })
    expect(other).toEqual({ ok: true, config: { instance: '8-abc123-def456', token: 'sample-token' } })
  })
})

describe('the only requests the tool can make', () => {
  it('reads, saves and publishes the Current Disasters item and nothing else', () => {
    expect(zestyRequest(config, { kind: 'read' })).toEqual({ url: ITEM, method: 'GET' })
    expect(zestyRequest(config, { kind: 'save', body: 'x' })).toEqual({
      url: ITEM,
      method: 'PATCH',
      body: JSON.stringify({ data: { body: 'x' } }),
    })
    const publish = zestyRequest(config, { kind: 'publish', version: 5 })
    expect(JSON.parse(publish.body ?? '')).toEqual([
      { ZUID: '7-beb69fc0fa-zk6tts', version: 5, publishAt: 'now', unpublishAt: 'never' },
    ])
  })

  it('never follows a redirect with the token', async () => {
    const fetcher = vi.fn(async () => reply(200, { data: { meta: { version: 1 }, data: { body: '' } } }))
    await readDisasterItem(config, fetcher)
    expect(fetcher).toHaveBeenCalledWith(ITEM, expect.objectContaining({ redirect: 'error' }))
  })

  it('refuses a reply about a different item', async () => {
    const fetcher = vi.fn(async () =>
      reply(200, { data: { meta: { ZUID: '7-aaaaaaaaaa-other', version: 1 }, data: { body: '' } } }),
    )
    await expect(readDisasterItem(config, fetcher)).rejects.toThrow(/different page/)
  })
})

describe('reading and pushing the item', () => {
  it('reads the latest version with the token as a bearer header', async () => {
    const fetcher = vi.fn(async () => reply(200, { data: { meta: { version: 87 }, data: { body: '<p>x</p>' } } }))
    await expect(readDisasterItem(config, fetcher)).resolves.toEqual({ version: 87, body: '<p>x</p>', updatedAt: null })
    expect(fetcher).toHaveBeenCalledWith(
      ITEM,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sample-token' }) }),
    )
  })

  it('refuses a push when Zesty has a newer version than the editor opened', () => {
    expect(() => assertVersion({ version: 88, body: '', updatedAt: null }, 87)).toThrow(/version 88/)
  })

  it('saves a new version and then publishes exactly that version', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { data: { ZUID: '7-beb69fc0fa-zk6tts', version: 88 } }))
      .mockResolvedValueOnce(reply(201, { data: {} }))
    await expect(
      pushDisasterBody(config, { version: 87, body: 'old', updatedAt: null }, 'new', fetcher),
    ).resolves.toEqual({ version: 88, previousVersion: 87 })
    expect(fetcher.mock.calls[0]).toEqual([
      ITEM,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ data: { body: 'new' } }) }),
    ])
    expect(fetcher.mock.calls[1]).toEqual([
      'https://8-abc123-def456.api.zesty.io/v1/content/models/6-c2b7f2a9ad-k4frxv/items/publishings/batch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([{ ZUID: '7-beb69fc0fa-zk6tts', version: 88, publishAt: 'now', unpublishAt: 'never' }]),
      }),
    ])
  })

  it('reports a saved but unpublished version when publishing fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { data: { version: 88 } }))
      .mockResolvedValueOnce(reply(500, { error: 'publish queue unavailable' }))
    await expect(
      pushDisasterBody(config, { version: 87, body: 'old', updatedAt: null }, 'new', fetcher),
    ).rejects.toThrow(/Saved as version 88 in Zesty, but publishing failed/)
  })

  it('explains a refused token without echoing it', async () => {
    const fetcher = vi.fn(async () => reply(401, { error: 'invalid session' }))
    const failure = readDisasterItem(config, fetcher)
    await expect(failure).rejects.toThrow(/refused the access token/)
    await expect(failure).rejects.not.toThrow(/sample-token/)
  })
})
