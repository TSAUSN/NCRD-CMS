import { expect, it } from 'vitest'
import { renderSiteWidget } from './site-widgets.ts'
import { compileSection } from './compile.ts'
import { editableSlots, sectionStartingValues, type SlotDef } from '@cms/schema'
it('filters server-rendered chapter links and omits unavailable or unsafe destinations', () => {
  const html = renderSiteWidget('chapter-directory', {
    query: 'peoria',
    chapters: [
      { name: 'Peoria Chapter', path: '/chapters/peoria' },
      { name: 'Detroit Chapter', externalUrl: 'https://example.test/detroit' },
      { name: 'Unpublished chapter' },
      { name: 'Unsafe chapter', path: '//evil.test' },
    ],
  })
  expect(html).toContain('action="/chapters" method="get"')
  expect(html).toContain('href="/chapters/peoria"')
  expect(html).toContain('1 chapter found')
  expect(html).not.toContain('Detroit')
  expect(html).not.toContain('Unpublished')
  expect(html).not.toContain('evil.test')
  const external = renderSiteWidget('chapter-directory', {
    chapters: [{ name: 'Detroit Chapter', externalUrl: 'https://example.test/detroit' }],
  })
  expect(external).toContain('Visit their website ↗')
  expect(external).toContain('noopener noreferrer')
  expect(renderSiteWidget('chapter-directory', { query: 'absent', chapters: [] })).toContain('No chapters match')
})
it('escapes query, chapter names and contact error values, without executing authored values', () => {
  expect(renderSiteWidget('chapter-directory', { query: '"><script>x</script>', chapters: [] })).not.toContain(
    '<script>',
  )
  const html = renderSiteWidget('contact-form', {
    contactError: '<script>bad</script>',
    contactValues: { comments: '</textarea><script>bad</script>' },
  })
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('method="post"')
  expect(html.match(/ required/g) ?? []).toHaveLength(5)
  expect(renderSiteWidget('contact-form', { contactSent: true })).toContain('Your message has been saved.')
})
it('keeps widget controls out of authored field editing and refuses attribute placement', () => {
  const slot: SlotDef = {
    id: 'widget',
    kind: 'text',
    label: 'Directory',
    constraints: { siteWidget: 'chapter-directory' },
  }
  expect(editableSlots([slot], {})).toEqual([])
  expect(sectionStartingValues([slot])).toEqual({})
  expect(
    compileSection({ sourceHtml: '<div title="{{widget}}"></div>', slots: [slot] }).blocking.length,
  ).toBeGreaterThan(0)
  expect(compileSection({ sourceHtml: '<div>{{widget}}</div>', slots: [slot] }).blocking).toEqual([])
})

it('uses the approved Echelon form wording while keeping ordinary form labels, required fields and error escaping', () => {
  const ordinary = renderSiteWidget('contact-form'),
    echelon = renderSiteWidget('contact-form', {
      contactStyle: 'echelon',
      contactError: '<broken>',
      contactValues: { comments: '</textarea><script>bad</script>' },
    })
  expect(ordinary).toContain('Comments <span>(required)</span>')
  expect(ordinary).not.toContain('placeholder="How can we help?"')
  expect(echelon).toContain('<label>Message<textarea name="comments"')
  expect(echelon.match(/ required/g)).toHaveLength(5)
  expect(echelon).toContain('name="website" tabindex="-1"')
  expect(echelon).toContain('&lt;broken&gt;')
  expect(echelon).not.toContain('<script>')
})
