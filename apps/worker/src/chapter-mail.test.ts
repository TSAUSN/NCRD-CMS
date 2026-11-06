import { beforeEach, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
const stub = vi.hoisted(() => ({ withWorkerSession: vi.fn(), query: vi.fn() }))
vi.mock('./handlers.ts', () => ({ withWorkerSession: stub.withWorkerSession }))
import { localChapterRecordingOrigin, recordLocalChapterMail } from './chapter-mail.ts'
const local = {
  AUTH_PROVIDER: 'local',
  CMS_LOCAL_TEST_MODE: 'true',
  MAILER_PROVIDER: 'recording',
  ADMIN_ORIGIN: 'http://localhost:3000',
  DATABASE_URL_WORKER: 'postgres://test@127.0.0.1:54329/cms_test',
}
beforeEach(() => {
  stub.query.mockReset().mockResolvedValue({ rows: [{ count: 2 }] })
  stub.withWorkerSession.mockReset().mockImplementation(async (_pool, _id, run) => run({ query: stub.query }))
})
it('records through the existing worker identity in explicit local recording mode', async () => {
  expect(localChapterRecordingOrigin(local)).toBe('http://localhost:3000')
  expect(await recordLocalChapterMail({} as Pool, 'local-worker', local)).toBe(2)
  expect(stub.withWorkerSession.mock.calls[0]?.[1]).toBe('local-worker')
  expect(stub.query).toHaveBeenCalledWith('SELECT app.record_due_local_chapter_mail($1) AS count', [
    'http://localhost:3000',
  ])
})
it('never touches a database when recording or local-only guards are missing', async () => {
  for (const patch of [
    { AUTH_PROVIDER: 'supabase' },
    { CMS_LOCAL_TEST_MODE: 'false' },
    { MAILER_PROVIDER: 'smtp' },
    { ADMIN_ORIGIN: 'https://example.test' },
    { ADMIN_ORIGIN: 'http://localhost:3000/private' },
    { DATABASE_URL_WORKER: 'postgres://test@example.test/db' },
    { DATABASE_URL_WORKER: 'postgres://test@127.0.0.1:5432/cms_demo' },
  ])
    expect(await recordLocalChapterMail({} as Pool, 'local-worker', { ...local, ...patch })).toBe(0)
  expect(stub.withWorkerSession).not.toHaveBeenCalled()
})
