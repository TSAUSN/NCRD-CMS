import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReleaseReadinessSummary } from './release-readiness-summary.tsx'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
import type { ReleaseCheck } from '../lib/releases.ts'

it('summarizes ready pages once and keeps every preview and each finding-specific Fix destination', () => {
  const ready = { ok: true, findings: [], blocking: [], warnings: [] } as unknown as ReleaseCheck['report']
  const checks: ReleaseCheck[] = Array.from({ length: 48 }, (_, i) => ({
    pageId: 'page-' + i,
    versionId: 'version-' + i,
    title: 'Page ' + (i + 1),
    report: ready,
  }))
  const render = (values: ReleaseCheck[]) =>
    renderToStaticMarkup(
      <ReleaseReadinessSummary checks={values} releaseId="review" planned canPreview applied={false} />,
    )
  const all = render(checks)
  expect(all).toContain('48 pages checked, all ready')
  expect(all.match(/Preview all selected changes/g)).toHaveLength(1)
  expect(all).not.toContain('Ready to publish.')
  expect(all).toContain('Checked pages (48)')
  expect(all).not.toMatch(/<details[^>]*\bopen/)
  expect(all).toContain('/releases/review/preview/page-47')
  const finding = { message: 'Add the missing image description.' } as ReleaseCheck['report']['findings'][number]
  const flagged = render([
    {
      ...checks[0]!,
      report: { ...ready, ok: false, findings: [finding] },
      fixLinks: ['/pages/page-0?section=2&field=photo'],
    },
  ])
  expect(flagged).toContain('1 page checked, 1 page needs attention')
  expect(flagged).toContain('Add the missing image description.')
  expect(flagged).toContain('/pages/page-0?section=2&amp;field=photo')
  expect(flagged).toContain('Needs attention')
})
