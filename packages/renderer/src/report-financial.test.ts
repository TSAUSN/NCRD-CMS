import { expect, it } from 'vitest'
import { reportFinancialMarkup } from './report-financial.ts'
const body =
  '<span class="ar-fill" data-report-expense="true"></span><span class="ar-fill" data-report-expense="true"></span><div class="ar-donut" data-report-revenue="true"></div>'
it('recalculates expense bars and revenue shares from edited financial amounts without JavaScript', () => {
  const values = {
      expenses: { items: ['i1', 'i2'] },
      expenses__i1__amount: '$1,000',
      expenses__i2__amount: '$250',
      revenue: { items: ['i1', 'i2'] },
      revenue__i1__amount: '$100',
      revenue__i2__amount: '$300',
    },
    first = reportFinancialMarkup(body, 'core-report-financial', values)
  expect(first).toContain('width:100.0000%')
  expect(first).toContain('width:25.0000%')
  expect(first).toContain('75.0000%')
  expect(reportFinancialMarkup(body, 'core-report-financial', { ...values, expenses__i2__amount: '$500' })).toContain(
    'width:50.0000%',
  )
})
it('cannot turn a hostile or unbounded amount into CSS and leaves unrelated sections unchanged', () => {
  const values = {
      expenses: { items: ['i1', 'i2'] },
      expenses__i1__amount: '1; background:url(https://example.test)',
      expenses__i2__amount: '999999999999999999999999999999',
      revenue: { items: ['i1'] },
      revenue__i1__amount: 'Infinity',
    },
    html = reportFinancialMarkup(body, 'core-report-financial', values)
  expect(html).not.toContain('example.test')
  expect(html).not.toContain('NaN')
  expect(html).not.toContain('Infinity')
  expect(html.match(/width:0.0000%/g)).toHaveLength(2)
  expect(reportFinancialMarkup(body, 'core-stats', values)).toBe(body)
})
