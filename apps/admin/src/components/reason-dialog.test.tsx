import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReasonDialog } from './confirm.tsx'
const props = {
  title: 'Record reason',
  explanation: 'Explain the exception.',
  label: 'Reason',
  value: 'Reviewed',
  confirmLabel: 'Proceed',
  onChange: () => {},
  onConfirm: () => {},
  onCancel: () => {},
}
describe('reason dialog pending markup', () => {
  it('makes pending edits and confirmation unavailable while keeping cancel focusable', () => {
    const html = renderToStaticMarkup(<ReasonDialog {...props} pending />)
    expect(html).toMatch(/<textarea[^>]*disabled=""/)
    expect(html).toMatch(/<button(?=[^>]*aria-disabled="true")[^>]*>Cancel<\/button>/)
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>Working…<\/button>/)
  })
  it('requires a complete trimmed explanation before breaking media references', () => {
    const short = renderToStaticMarkup(<ReasonDialog {...props} minLength={8} value="  Short  " />)
    expect(short).toContain('Use at least 8 characters.')
    expect(short).toContain('minLength="8"')
    expect(short).toMatch(/<button(?=[^>]*disabled="")[^>]*>Proceed<\/button>/)
    const complete = renderToStaticMarkup(<ReasonDialog {...props} minLength={8} value="Approved replacement" />)
    expect(complete).not.toMatch(/<button(?=[^>]*disabled="")[^>]*>Proceed<\/button>/)
  })
  it('preserves the idle confirmation and required reason', () => {
    const html = renderToStaticMarkup(<ReasonDialog {...props} />)
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('>Proceed</button>')
    expect(renderToStaticMarkup(<ReasonDialog {...props} value="" />)).toMatch(
      /<button(?=[^>]*disabled="")[^>]*>Proceed<\/button>/,
    )
  })
})
