import { describe, it, expect } from 'vitest'
import { DEFAULT_FOOTER_CONFIG, type NavTree } from '@cms/schema'
import {
  pageMenuSwitch,
  reorderPageMenu,
  footerPageSwitch,
  footerPageMembership,
  menuChangeWords,
  footerLinkChangeWords,
} from './page-list-links.ts'
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222',
  c = '33333333-3333-4333-8333-333333333333',
  page = { id: a, title: '[Page]', slug: 'ways-we-help/health' },
  child = { label: '[Saved label]', target: { type: 'page' as const, page_id: a }, visible: true }
describe('shared Pages links', () => {
  it('removes the last dropdown link without an invalid empty group; restores its published parent and label', () => {
    const published: NavTree = [
        {
          label: 'Ways We Help',
          target: { type: 'url', url: '/' },
          dropdownGroup: true,
          visible: true,
          children: [child, { label: '[Other]', target: { type: 'page', page_id: b }, visible: true }],
        },
      ],
      off = pageMenuSwitch(published, published, page, false)
    expect(off[0]!.children).toHaveLength(1)
    const on = pageMenuSwitch(off, published, page, true)
    expect(on[0]!.children?.at(-1)).toEqual(child)
    expect(pageMenuSwitch([{ ...published[0]!, children: [child] }], published, page, false)).toEqual([])
  })
  it('keeps children when a parent page is removed and keeps external menu positions during reorder', () => {
    const tree: NavTree = [
      { ...child, children: [{ label: '[Child]', target: { type: 'page', page_id: b }, visible: true }] },
      { label: '[Website]', target: { type: 'url', url: 'https://example.org' }, visible: true },
      { label: '[Third]', target: { type: 'page', page_id: c }, visible: true },
    ]
    expect(pageMenuSwitch(tree, tree, page, false)[0]!.target).toEqual({ type: 'page', page_id: b })
    const moved = reorderPageMenu(tree, [c, a, b])
    expect(moved[1]).toEqual(tree[1])
    expect(moved[0]!.target).toEqual({ type: 'page', page_id: c })
    expect(moved[2]!.children).toEqual(tree[0]!.children)
    expect(
      menuChangeWords(tree, [
        ...moved,
        { label: '[Added]', target: { type: 'url', url: 'https://example.org/new' }, visible: true },
      ]),
    ).toEqual(['Menu: added [Added]', 'Menu: reordered [Third], [Website], [Saved label], [Child]'])
  })
  it('uses the existing footer configuration without changing its other content and emits saved-difference words', () => {
    const before = structuredClone(DEFAULT_FOOTER_CONFIG),
      on = footerPageSwitch(before, page, true)
    expect(footerPageMembership(on, page)).toBe(true)
    expect(footerPageSwitch(on, page, false)).toEqual(before)
    expect(footerLinkChangeWords(before, on)).toEqual(['Footer: added [Page]'])
    expect(menuChangeWords([], pageMenuSwitch([], [], page, true))).toEqual(['Menu: added [Page]'])
    expect(before).toEqual(DEFAULT_FOOTER_CONFIG)
  })
})

it('describes a changed destination once instead of an apparent add and remove', () => {
  const before: NavTree = [{ label: '[Visit]', visible: true, target: { type: 'url', url: '/visit#before' } }],
    after: NavTree = [{ label: '[Visit]', visible: true, target: { type: 'url', url: '/visit#after' } }]
  expect(menuChangeWords(before, after)).toEqual(['Menu: changed where [Visit] goes'])
  const footer = {
    ...structuredClone(DEFAULT_FOOTER_CONFIG),
    groups: [
      { heading: '[Links]', links: [{ label: '[Visit]', target: { type: 'url' as const, url: '/visit#before' } }] },
    ],
  }
  expect(
    footerLinkChangeWords(footer, {
      ...footer,
      groups: [{ heading: '[Links]', links: [{ label: '[Visit]', target: { type: 'url', url: '/visit#after' } }] }],
    }),
  ).toEqual(['Footer: changed where [Visit] goes'])
})

it('does not invent a rename when two existing menu links share a destination', () => {
  const before: NavTree = [
    {
      label: 'Ways to Give',
      visible: true,
      target: { type: 'url', url: 'https://give.sawso.org' },
      children: [{ label: 'Donate Today', visible: true, target: { type: 'url', url: 'https://give.sawso.org' } }],
    },
  ]
  expect(
    menuChangeWords(before, [...before, { label: 'QA review', visible: true, target: { type: 'page', page_id: a } }]),
  ).toEqual(['Menu: added QA review'])
  expect(menuChangeWords(before, before)).toEqual([])
})
