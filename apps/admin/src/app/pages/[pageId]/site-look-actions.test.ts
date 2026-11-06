import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_HEADER_CONFIG, DEFAULT_FOOTER_CONFIG } from '@cms/schema'
const stubs = vi.hoisted(() => ({ session: vi.fn(), page: vi.fn(), site: vi.fn(), asUser: vi.fn(), query: vi.fn() }))
vi.mock('../../../lib/session.ts', () => ({ currentSession: stubs.session }))
vi.mock('../../../lib/queries.ts', () => ({
  getPage: stubs.page,
  getSite: stubs.site,
  getGlobalElementsWorkspace: vi.fn(),
  getNavigationWorkspace: vi.fn(),
  canManageGlobalElements: vi.fn(),
}))
vi.mock('@cms/platform', () => ({ asUser: stubs.asUser }))
import { savePageSiteLook } from './site-look-actions.ts'
const input = {
  pageId: 'page',
  headerRevision: 1,
  footerRevision: 1,
  menuRevision: 1,
  header: DEFAULT_HEADER_CONFIG,
  footer: DEFAULT_FOOTER_CONFIG,
  menu: [],
  frameChanged: true,
  menuChanged: false,
}
beforeEach(() => {
  vi.resetAllMocks()
  stubs.session.mockResolvedValue({ principal: { userId: 'actor' } })
  stubs.page.mockResolvedValue({ site_id: 'site' })
  stubs.site.mockResolvedValue({ original_design: false })
  stubs.asUser.mockImplementation(async (_actor, action) => action({ query: stubs.query }))
  stubs.query.mockResolvedValue({ rows: [{ header_revision: 2, footer_revision: 3 }] })
})
it('rejects a native page-level shared-area write before opening a write transaction', async () => {
  expect(await savePageSiteLook(input)).toMatchObject({
    ok: false,
    message: 'Use Header & menu or Footer at site level to change these shared areas.',
  })
  expect(stubs.asUser).not.toHaveBeenCalled()
})
it('keeps the original-design command path and returned revision contract', async () => {
  stubs.site.mockResolvedValue({ original_design: true })
  expect(await savePageSiteLook(input)).toMatchObject({
    ok: true,
    headerRevision: 2,
    footerRevision: 3,
    menuRevision: 1,
  })
  expect(stubs.query).toHaveBeenCalledTimes(1)
  expect(stubs.query.mock.calls[0]![0]).toContain('app.save_global_elements_draft')
})
it('keeps signed-out callers away from page and frame data', async () => {
  stubs.session.mockResolvedValue(null)
  expect(await savePageSiteLook(input)).toMatchObject({ ok: false })
  expect(stubs.page).not.toHaveBeenCalled()
  expect(stubs.asUser).not.toHaveBeenCalled()
})
