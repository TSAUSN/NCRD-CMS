import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { REPORT_PAGE_CSS, REPORT_TEXT_CSS } from './report-page-presentation.ts'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

// The report skin is kept one rule per line for review, but the stylesheet a
// visitor receives must not change when the source is reorganised. Update these
// hashes only together with an intended, reviewed change to the report styles.
describe('report presentation stylesheet', () => {
  it('joins its rules into the exact approved stylesheet', () => {
    expect(REPORT_PAGE_CSS).toHaveLength(127082)
    expect(sha256(REPORT_PAGE_CSS)).toBe('de7fb0aef0dc5729260ad75ef3143775a53c20c619de8c809619a2b32d2eef3c')
    expect(sha256(REPORT_TEXT_CSS)).toBe('3fde44bb3e03c143d9d316b8745d550f1ceea4a651b5ae24b46260f94f761afd')
  })
})
