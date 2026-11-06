import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusPill } from './status-pill.tsx'
it('uses the same plain pending label at both densities without changing its stored status', () => {
  for (const compact of [true, false]) {
    const html = renderToStaticMarkup(<StatusPill status="Live · changes not published" compact={compact} />)
    expect(html).toContain('Changes not live')
    expect(html).toContain('data-status="pending"')
    expect(html).not.toContain('changes not published')
  }
})
