import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', () => ({ asUser: vi.fn() }))
import type { Queryable } from '@cms/platform'
import { siteSettingsWorkspace } from './site-settings.ts'
function client(draft: unknown) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        { id: 'settings', revision: '4', name: '[Site]', draft_version_id: 'v4', published_version_id: 'v3', draft },
      ],
    })
    .mockResolvedValueOnce({ rows: [] })
  return { query, db: { query } as unknown as Queryable }
}
it('refuses unknown legacy settings before another query or a replaceable editing projection is returned', async () => {
  for (const draft of [
    { name: '[Site]', unknownContact: { email: 'keep@example.test' } },
    { schemaVersion: 2, name: '[Site]' },
  ]) {
    const { query, db } = client(draft)
    await expect(siteSettingsWorkspace(db, 'site')).rejects.toThrow('need review')
    expect(query).toHaveBeenCalledTimes(1)
  }
})
it('preserves supported canonical blocks and normalizes only the known name-only legacy form', async () => {
  const canonical = { schemaVersion: 1, name: '[Site]', search: { verification: [], hints: '[Keep hints]' } },
    known = client(canonical),
    legacy = client({ name: '[Legacy name]' })
  expect((await siteSettingsWorkspace(known.db, 'site')).settings).toEqual(canonical)
  expect((await siteSettingsWorkspace(legacy.db, 'site')).settings).toEqual({ schemaVersion: 1, name: '[Legacy name]' })
})
