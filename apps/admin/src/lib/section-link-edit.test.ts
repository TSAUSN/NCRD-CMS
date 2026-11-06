import { describe, it, expect } from 'vitest'
import { sectionAnchorNames, type SectionInstance } from '@cms/schema'
import { renamedSectionUrl, rewriteSectionLinks, nextSectionAnchor, changeSectionAnchor } from './section-link-edit.ts'
const context = {
  targetPaths: ['/health'],
  pagePath: '/health',
  hosts: ['local.staging.localhost'],
  oldName: 'health-stories',
  newName: 'care-stories',
}
describe('section link drafts', () => {
  it('changes only same-site destinations and keeps query strings and absolute address style', () => {
    for (const [url, next] of [
      ['#health-stories', '#care-stories'],
      ['/health?view=all#health-stories', '/health?view=all#care-stories'],
      ['https://local.staging.localhost/health#health-stories', 'https://local.staging.localhost/health#care-stories'],
      ['https://elsewhere.test/health#health-stories', 'https://elsewhere.test/health#health-stories'],
      ['/other#health-stories', '/other#health-stories'],
    ])
      expect(renamedSectionUrl(url!, context)).toBe(next)
    expect(renamedSectionUrl('#health-stories', { ...context, pagePath: '/other' })).toBe('#health-stories')
    expect(rewriteSectionLinks({ url: '#health-stories' }, { ...context, fragmentOnly: false })).toMatchObject({
      count: 0,
      unsafe: true,
    })
    expect(renamedSectionUrl('/health#earlier', { ...context, oldNames: ['health-stories', 'earlier'] })).toBe(
      '/health#care-stories',
    )
  })
  it('preserves prose and formatting while rewriting buttons and rich-text links', () => {
    const before = {
        button: { label: 'health-stories', url: '/health#health-stories' },
        body: '<p>health-stories <a class="kept" href="/health?x=1&amp;y=2#health-stories">[Words]</a></p>',
        other: 'health-stories',
      },
      after = rewriteSectionLinks(before, context)
    expect(after.count).toBe(2)
    expect(after.unsafe).toBe(false)
    expect(after.value.button).toEqual({ label: 'health-stories', url: '/health#care-stories' })
    expect(after.value.body).toBe(
      '<p>health-stories <a class="kept" href="/health?x=1&amp;y=2#care-stories">[Words]</a></p>',
    )
    expect(before.button.url).toBe('/health#health-stories')
    expect(rewriteSectionLinks('<a href=/health#health-stories>[Words]</a>', context).unsafe).toBe(true)
  })
  it('keeps earlier public names and avoids both primary and earlier names for new anchors', () => {
    const section = {
        section_def_id: '11111111-1111-4111-8111-111111111111',
        section_def_version: 1,
        hidden: false,
        hidden_at: [],
        label: '[Section]',
        values: { __cms_anchor: 'health-stories', __cms_anchor_aliases: ['care-stories'], heading: '[Words]' },
      } as SectionInstance,
      changed = changeSectionAnchor(section, 'new-stories')
    expect(sectionAnchorNames(changed.values)).toEqual(['new-stories', 'health-stories', 'care-stories'])
    expect(nextSectionAnchor('care-stories', [section])).toBe('care-stories-2')
    expect(changed.values.heading).toBe('[Words]')
  })
})
