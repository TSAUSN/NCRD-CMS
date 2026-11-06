import { expect, it } from 'vitest'
import { renderNavigation } from './render.ts'
it('renders a dropdown group with native details and real child links, without a fake home destination', () => {
  const html = renderNavigation(
    [
      {
        label: 'Get involved',
        target: { type: 'url', url: '/' },
        visible: true,
        dropdownGroup: true,
        children: [{ label: 'Visit', target: { type: 'url', url: '/visit' }, visible: true }],
      },
    ],
    () => null,
  )
  expect(html).toContain('<details><summary>Get involved</summary>')
  expect(html).toContain('href="/visit"')
  expect(html).not.toContain('href="/"')
  expect(
    renderNavigation(
      [{ label: 'Empty', target: { type: 'url', url: '/' }, visible: true, dropdownGroup: true }],
      () => null,
    ),
  ).toBe('')
})
it('preserves ordinary parent destinations and hides unavailable child pages', () => {
  const html = renderNavigation(
    [
      {
        label: 'About',
        target: { type: 'url', url: '/about' },
        visible: true,
        children: [{ label: 'Unavailable', target: { type: 'page', page_id: 'missing' }, visible: true }],
      },
    ],
    () => null,
  )
  expect(html).toBe('<ul class="cms-nav-list"><li class="cms-nav-item"><a href="/about">About</a></li></ul>')
})
