import { repeatItemKeys } from '@cms/schema'
/** Charts derive only bounded finite numbers;all authored words still use normal field sinks. */
function amount(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!/^\$?[\d,]+(?:\.\d{1,2})?$/.test(text)) return 0
  const n = Number(text.replace(/[$,]/g, ''))
  return Number.isFinite(n) && n >= 0 && n <= 1e15 ? n : 0
}
export function reportFinancialMarkup(body: string, slug: string | undefined, values: Record<string, unknown>): string {
  if (slug !== 'core-report-financial') return body
  const numbers = repeatItemKeys(values.expenses).map(key => amount(values['expenses__' + key + '__amount'])),
    max = Math.max(0, ...numbers)
  let index = 0
  const revenue = repeatItemKeys(values.revenue).map(key => amount(values['revenue__' + key + '__amount'])),
    total = revenue.reduce((sum, n) => sum + n, 0),
    share = total > 0 ? Math.min(100, Math.max(0, ((revenue[1] ?? revenue[0] ?? 0) / total) * 100)) : 0
  return body
    .replace(
      /<tr class="ar-group"><th scope="row">([\s\S]*?)<\/th><td>[\s\S]*?<\/td><\/tr>/g,
      '<tr class="ar-group"><th colspan="2">$1</th></tr>',
    )
    .replace(/class="ar-fill" data-report-expense="true"/g, () => {
      const value = numbers[index++] ?? 0
      return 'class="ar-fill" style="width:' + (max > 0 ? (value / max) * 100 : 0).toFixed(4) + '%"'
    })
    .replace(
      'class="ar-donut" data-report-revenue="true"',
      'class="ar-donut" style="background:conic-gradient(var(--ar-red) 0 ' +
        share.toFixed(4) +
        '%,var(--ar-navy) ' +
        share.toFixed(4) +
        '% 100%)"',
    )
}
