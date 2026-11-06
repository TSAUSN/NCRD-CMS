import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TemplateUpdateSites } from './template-update-sites.tsx'
import type { NationalSiteReview } from '../lib/national-template.ts'
it('keeps two large update scopes closed, with all page names and duplicate counts available', () => {
  const sites: NationalSiteReview[] = [
    ['chapters', 25],
    ['pages', 30],
  ].map(([id, count]) => ({
    id: String(id),
    name: String(id),
    pages: Number(count),
    changedPages: Array.from({ length: Number(count) }, (_, n) => (n < 2 ? 'Florence Chapter' : String(id) + ' ' + n)),
    themeChanged: true,
    fingerprint: 'reviewed',
    connected: true,
    mayChangeColours: false,
  }))
  const html = renderToStaticMarkup(
    <TemplateUpdateSites sites={sites} selected={['pages']} pending={false} onSelect={() => {}} />,
  )
  expect(html.match(/<details /g)).toHaveLength(2)
  expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/)
  expect(html).toContain('25 pages with section updates')
  expect(html).toContain('30 pages with section updates')
  expect(html).toContain('chapters 24')
  expect(html).toContain('pages 29')
  expect(html.match(/Florence Chapter.*?2 pages/g)).toHaveLength(2)
  expect(html.match(/checked=""/g)).toHaveLength(1)
})
