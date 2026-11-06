import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SiteCardPreview } from './site-card-preview.tsx'
it('shows a saved picture immediately without an iframe or page-loading overlay', () => {
  for (const name of ['Better Together 2027', 'Human Needs Index']) {
    const html = renderToStaticMarkup(<SiteCardPreview name={name} src="/site-files/reviewed/image.png" />)
    expect(html).toContain('<img')
    expect(html).toContain('src="/site-files/reviewed/image.png"')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('Loading saved preview')
  }
})
