import { describe, expect, it } from 'vitest'
import { rewriteWorkingHtml, rewriteWorkingUrl, rewriteWorkingValues, planWorkingDrafts } from './working-drafts.ts'

describe('migration working-page routes', () => {
  const routes = new Map([
    ['/source-home', '/'],
    ['/source-methodology', '/methodology'],
  ])
  it('preserves fragments and queries and never rewrites an unrelated or external path', () => {
    expect(rewriteWorkingUrl('/source-methodology?download=yes#notes', routes)).toBe('/methodology?download=yes#notes')
    expect(rewriteWorkingUrl('/source-home#about', routes)).toBe('/#about')
    expect(rewriteWorkingUrl('https://example.test/source-home', routes)).toBe('https://example.test/source-home')
    expect(rewriteWorkingUrl('/source-home-more', routes)).toBe('/source-home-more')
  })
  it('rewrites only actual HTML destinations and retains literal source-path prose', () => {
    expect(rewriteWorkingHtml('<p>/source-home</p><a href="/source-home#about">Home</a>', routes)).toBe(
      '<p>/source-home</p><a href="/#about">Home</a>',
    )
    expect(
      rewriteWorkingValues(
        {
          text: '/source-home',
          link: { url: '/source-home' },
          copy: '<a href="/source-methodology">Method</a>',
          nested: [{ href: '/source-home' }],
        },
        routes,
      ),
    ).toEqual({
      text: '/source-home',
      link: { url: '/' },
      copy: '<a href="/methodology">Method</a>',
      nested: [{ href: '/' }],
    })
  })
  it('selects published source over draft, preserves draft-only event pages, and omits empty test pages', async () => {
    const refs = [
      {
        key: 'sites/humanneedsindex/pages/home',
        sourceSite: 'humanneedsindex',
        sourcePage: 'home',
        sourceState: 'draft',
        sections: [{}],
        issues: ['review'],
      },
      {
        key: 'publishedPages/humanneedsindex_home',
        sourceSite: 'humanneedsindex',
        sourcePage: 'home',
        sourceState: 'published',
        sections: [{}],
        issues: ['review'],
      },
      {
        key: 'sites/echelonsymposium/pages/home',
        sourceSite: 'echelonsymposium',
        sourcePage: 'home',
        sourceState: 'draft',
        sections: [{}],
        issues: [],
      },
      {
        key: 'sites/humanneedsindex/pages/test',
        sourceSite: 'humanneedsindex',
        sourcePage: 'test',
        sourceState: 'draft',
        sections: [],
        issues: [],
      },
    ]
    const plan = await planWorkingDrafts(
      {
        query: async sql => ({
          rows: sql.includes('SELECT bundle')
            ? [{ bundle: { references: refs, records: [], manifestSha256: 'manifest' } }]
            : refs.map((reference, index) => ({
                source_key: `backup/${reference.key}`,
                page_id: `page-${index}`,
                site_id: reference.sourceSite,
                record_id: `record-${index}`,
                draft_version_id: `version-${index}`,
                source_version_id: `original-${index}`,
                revision: '1',
              })),
        }),
      },
      'run',
    )
    expect(plan.pages.map(page => [page.pageId, page.title, page.slug])).toEqual([
      ['page-1', 'Human Needs Index', ''],
      ['page-2', 'Echelon Symposium', ''],
    ])
    expect(plan.pages[0]?.issues).toEqual(['review'])
  })
})
