import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { localChapterMailOrigin } from './local-chapter-mail.ts'
const local = {
  AUTH_PROVIDER: 'local',
  CMS_LOCAL_TEST_MODE: 'true',
  MAILER_PROVIDER: 'recording',
  ADMIN_ORIGIN: 'http://localhost:3000',
  DATABASE_URL_AUTHENTICATED: 'postgres://test@127.0.0.1:54329/cms_test',
}
it('enables recording only for explicit loopback local configuration', () => {
  expect(localChapterMailOrigin(local)).toBe('http://localhost:3000')
  for (const patch of [
    { AUTH_PROVIDER: 'supabase' },
    { CMS_LOCAL_TEST_MODE: 'false' },
    { MAILER_PROVIDER: 'smtp' },
    { ADMIN_ORIGIN: 'https://example.test' },
    { ADMIN_ORIGIN: 'http://localhost:3000/private' },
    { ADMIN_ORIGIN: 'http://user:password@localhost:3000' },
    { DATABASE_URL_AUTHENTICATED: 'postgres://test@example.test/db' },
  ])
    expect(localChapterMailOrigin({ ...local, ...patch })).toBeNull()
})
