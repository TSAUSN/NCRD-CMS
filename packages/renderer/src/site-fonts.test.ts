import { expect, it } from 'vitest'
import { renderSiteFontCss } from './site-fonts.ts'
it('generates closed registered font CSS and refuses arbitrary keys or URL syntax', () => {
  const assetId = '11111111-1111-4111-a111-111111111111'
  expect(renderSiteFontCss([{ assetId, fontKey: 'trajan-regular' }])).toBe(
    `@font-face{font-family:'Trajan Pro 3';src:url('/assets/${assetId}') format('opentype');font-weight:400;font-style:normal;font-display:swap}`,
  )
  for (const value of [
    [{ assetId, fontKey: 'constructor' }],
    [{ assetId: "x');}</style>", fontKey: 'trajan-regular' }],
    [{ assetId, fontKey: 'custom-font' }],
  ])
    expect(renderSiteFontCss(value)).toBe('')
  expect(renderSiteFontCss(undefined)).toBe('')
})
