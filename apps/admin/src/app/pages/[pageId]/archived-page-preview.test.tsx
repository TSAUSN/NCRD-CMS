import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'

const queries = vi.hoisted(() => ({
  getPage: vi.fn(),
  getSite: vi.fn(),
  roleLabel: vi.fn(),
  getDraft: vi.fn(),
  listSectionLibrary: vi.fn(),
  listLinkTargets: vi.fn(),
  listMediaAssets: vi.fn(),
  isSuperAdmin: vi.fn(),
  listPageSectionVersions: vi.fn(),
  getPublishedThemeColors: vi.fn(),
  getDraftThemeColors: vi.fn(),
}))
const session = vi.hoisted(() => ({ currentSession: vi.fn() }))
const readiness = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/queries.ts', () => queries)
vi.mock('../../../lib/session.ts', () => session)
vi.mock('../../../lib/review-queries.ts', () => ({ listPageReviewSubmissions: vi.fn() }))
vi.mock('../../actions/page-publish.ts', () => ({ runReadiness: readiness }))
vi.mock('./editor.tsx', () => ({ PageEditor: () => null }))
vi.mock('../../../components/app-shell.tsx', () => ({ AppShell: () => null }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found')
  },
}))

import EditPage from './page.tsx'
import { ArchivedPagePreview } from './archived-page-preview.tsx'
import { ScriptlessPreview } from '../../../components/scriptless-preview.tsx'
import { SCRIPTLESS_PREVIEW_SANDBOX } from '../../../lib/scriptless-preview.ts'

const site = { id: 'site-a', name: 'Reference site', slug: 'reference', status: 'archived', staging_hostname: null }
const savedPage = {
  id: 'page-a',
  title: 'Reference page',
  site_id: site.id,
  draft_version_id: 'saved-version',
  published_version_id: 'live-version',
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child =>
    isValidElement<Record<string, unknown>>(child) ? [child, ...nodes(child.props.children as ReactNode)] : [],
  )
}
function route() {
  return EditPage({ params: Promise.resolve({ pageId: savedPage.id }), searchParams: Promise.resolve({}) })
}
function view(privateSite = false) {
  return ArchivedPagePreview({
    pageId: savedPage.id,
    title: savedPage.title,
    versionId: savedPage.draft_version_id,
    site: { ...site, initial_release_required: privateSite },
    email: 'editor@example.test',
    role: 'Editor',
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  session.currentSession.mockResolvedValue({
    email: 'editor@example.test',
    principal: { userId: 'editor', memberships: new Map() },
  })
  queries.getPage.mockResolvedValue(savedPage)
  queries.getSite.mockResolvedValue(site)
  queries.roleLabel.mockResolvedValue('Editor')
})

describe('archived page entry', () => {
  it('returns the read-only saved page before loading any editable page data or running readiness', async () => {
    const result = await route()
    expect(result.type).toBe(ArchivedPagePreview)
    expect(result.props).toMatchObject({ pageId: savedPage.id, versionId: savedPage.draft_version_id, site })
    expect(queries.getDraft).not.toHaveBeenCalled()
    expect(queries.listSectionLibrary).not.toHaveBeenCalled()
    expect(queries.listMediaAssets).not.toHaveBeenCalled()
    expect(readiness).not.toHaveBeenCalled()
  })
  it('requires both authorized page and site visibility', async () => {
    queries.getPage.mockResolvedValueOnce(null)
    await expect(route()).rejects.toThrow('not found')
    expect(queries.getSite).not.toHaveBeenCalled()
    queries.getSite.mockResolvedValueOnce(null)
    await expect(route()).rejects.toThrow('not found')
  })
  it('falls back to an existing published version when no saved draft exists', async () => {
    queries.getPage.mockResolvedValue({ ...savedPage, draft_version_id: null })
    expect((await route()).props.versionId).toBe(savedPage.published_version_id)
  })
  it.each([false, true])(
    'keeps the appearance context explicit and the preview scriptless (private=%s)',
    privateSite => {
      const tree = nodes(view(privateSite))
      const preview = tree.find(node => node.type === ScriptlessPreview)!
      expect(preview.props.src).toBe(`/preview/saved-version?readonly=1${privateSite ? '&site=draft' : ''}`)
      expect(tree.filter(node => node.type === 'button' || node.type === 'form')).toHaveLength(0)
      expect(tree.find(node => node.props.role === 'status')?.props.children).toContain(
        privateSite ? 'Saved site appearance' : 'Published site appearance',
      )
      const iframe = renderToStaticMarkup(<ScriptlessPreview {...preview.props} />)
      expect(iframe).toContain(`sandbox="${SCRIPTLESS_PREVIEW_SANDBOX}"`)
      expect(iframe).not.toContain('allow-scripts')
    },
  )
})
