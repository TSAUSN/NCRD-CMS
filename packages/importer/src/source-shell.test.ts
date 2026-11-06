import { describe, expect, it } from 'vitest'
import { sourceShell } from './source-shell.ts'
import type { MigrationBundle } from './migration.ts'

const pageId = '10000000-0000-4000-a000-000000000001'
const logoId = '10000000-0000-4000-a000-000000000002'
describe('source frame reconstruction', () => {
  it('maps native menu, authored logo and footer while preserving a disabled registration state', () => {
    const html =
      '<header><a><img src="/logo.png" alt=""></a><nav aria-label="Primary navigation"><a href="/">Home</a><a href="#agenda">Agenda</a></nav>' +
      '<a class="header-cta registration-unavailable" href="#register">Register Now</a></header><footer>' +
      '<div><h3>Attend</h3><ul><li><a href="#agenda">Agenda</a></li></ul></div><a href="mailto:events@example.test">Contact</a>' +
      '<p data-block-id="footer-copy">&copy; <span></span> Source organisation</p><a data-block-id="footer-legal-privacy" href="https://example.test/privacy">Privacy</a></footer>'
    const bundle: Pick<MigrationBundle, 'records'> = {
      records: [
        {
          key: 'source/tsa-echelonsymposium/index.html',
          payload: { text: html },
          kind: 'site-source',
          sourceSite: 'echelonsymposium',
          sourceSha256: 'a'.repeat(64),
          issues: [],
        },
      ],
    }
    const shell = sourceShell(bundle, 'echelonsymposium', [{ pageId, slug: '' }], new Map([['/logo.png', logoId]]))
    expect(shell.header.brand.logoMediaId).toBe(logoId)
    expect(shell.header.cta).toBeNull()
    expect(shell.navigation).toEqual([
      { label: 'Home', target: { type: 'page', page_id: pageId }, visible: true },
      { label: 'Agenda', target: { type: 'url', url: '/#agenda' }, visible: true },
    ])
    expect(shell.footer.groups).toEqual([
      { heading: 'Attend', links: [{ label: 'Agenda', target: { type: 'url', url: '/#agenda' } }] },
    ])
    expect(shell.footer.contact).toEqual({ email: 'events@example.test' })
    expect(shell.footer.legal.copyright).toBe('© Source organisation')
    expect(shell.issues).toContain('source-frame-visual-review-required')
  })
})
