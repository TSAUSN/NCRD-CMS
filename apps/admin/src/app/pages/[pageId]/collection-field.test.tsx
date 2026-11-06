import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CollectionField } from './collection-field.tsx'

const props = {
  id: 'collection-resource',
  siteId: '22222222-2222-4222-8222-222222222222',
  definitionId: '33333333-3333-4333-8333-333333333333',
  version: 1,
  fieldId: 'resources',
  onChange: () => {},
}

describe('collection inspector initial render', () => {
  it('renders an automatic binding as named controls rather than object text', () => {
    const html = renderToStaticMarkup(
      <CollectionField {...props} value={{ readerKey: 'resources', selection: { mode: 'automatic', limit: 25 } }} />,
    )
    expect(html).toContain('resources (current selection)')
    expect(html).toContain('Items to show')
    expect(html).toContain('Maximum items')
    expect(html).toContain('value="25"')
    expect(html).toContain('Loading lists for this site')
    expect(html).not.toContain('[object Object]')
  })
  it('preserves manual order and missing selections before options arrive', () => {
    const html = renderToStaticMarkup(
      <CollectionField
        {...props}
        value={{ readerKey: 'resources', selection: { mode: 'manual', stableKeys: ['second', 'first'] } }}
      />,
    )
    expect(html.indexOf('second (not published)')).toBeLessThan(html.indexOf('first (not published)'))
    expect(html).toContain('Move second up')
    expect(html).toContain('Remove first from selection')
    expect(html).not.toContain('[object Object]')
  })
  it('leaves malformed values unselected and exposes a separate collection management path', () => {
    const html = renderToStaticMarkup(<CollectionField {...props} value="[object Object]" />)
    expect(html).toContain('Choose a list')
    expect(html).toContain(`/sites/${props.siteId}/content`)
    expect(html).toContain('target="_blank" rel="noopener"')
    expect(html).not.toContain('value="[object Object]"')
  })
})
