import { beforeEach, expect, it, vi } from 'vitest'
import { evaluateVersionReadiness, type Queryable } from '@cms/platform'
import type { ReadinessReport } from '@cms/domain'
import { retryScheduledPage, type ScheduleRetryInput } from './schedule-retry.ts'
vi.mock('@cms/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@cms/platform')>()),
  evaluateVersionReadiness: vi.fn(),
}))
const input: ScheduleRetryInput = {
  id: 'failure',
  revision: '7',
  runAt: '2030-01-01T12:00:00.000Z',
  override: '',
  requestId: 'request',
}
const blocked = { rule: 'missing_h1', severity: 'blocking', message: 'Add a heading' } as const
const report = (findings: ReadinessReport['findings']): ReadinessReport =>
  ({ ok: !findings.length, findings, blocking: findings, advisory: [], policyVersion: 2 }) as ReadinessReport
function client(
  options: { action?: 'publish' | 'unpublish'; receipt?: boolean; missing?: boolean; status?: string } = {},
) {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('SELECT item_id')
      ? options.missing
        ? []
        : [
            {
              item_id: 'page',
              version_id: 'original-version',
              action: options.action ?? 'publish',
              status: options.status ?? 'failed',
            },
          ]
      : sql.includes('SELECT id')
        ? options.receipt
          ? [{ id: 'saved-retry' }]
          : []
        : [],
  }))
  return {
    db: { query } as unknown as Queryable,
    query,
    commands: () => query.mock.calls.filter(([sql]) => sql.startsWith('SELECT app.retry_page_schedule')),
  }
}
beforeEach(() => {
  vi.mocked(evaluateVersionReadiness).mockReset()
  vi.mocked(evaluateVersionReadiness).mockResolvedValue(report([]))
})
it('loads the original intention through publish permission before evaluating or writing', async () => {
  const c = client({ missing: true })
  await expect(retryScheduledPage(c.db, input)).rejects.toThrow('not available')
  expect(c.query.mock.calls[0]![0]).toContain('app.can_publish(site_id)')
  expect(evaluateVersionReadiness).not.toHaveBeenCalled()
  expect(c.commands()).toHaveLength(0)
})
it('refuses nonfailed records without adding another attempt', async () => {
  const c = client({ status: 'succeeded' })
  await expect(retryScheduledPage(c.db, input)).rejects.toThrow('Only a failed')
  expect(c.commands()).toHaveLength(0)
})
it('reevaluates the original saved version and returns blocking feedback without writing', async () => {
  const c = client()
  vi.mocked(evaluateVersionReadiness).mockResolvedValue(report([blocked]))
  expect(await retryScheduledPage(c.db, input)).toMatchObject({ ok: false, report: { blocking: [blocked] } })
  expect(evaluateVersionReadiness).toHaveBeenCalledWith(c.db, 'original-version', 'member')
  expect(c.commands()).toHaveLength(0)
})
it('requires fresh reviewed findings before accepting an explicit new override', async () => {
  const c = client()
  vi.mocked(evaluateVersionReadiness).mockResolvedValue(report([blocked]))
  expect(
    await retryScheduledPage(c.db, { ...input, override: 'Approved exception', reviewedFindings: [] }),
  ).toMatchObject({ ok: false, message: expect.stringContaining('findings changed') })
  expect(c.commands()).toHaveLength(0)
  expect(
    await retryScheduledPage(c.db, { ...input, override: 'Approved exception', reviewedFindings: [blocked] }),
  ).toMatchObject({ ok: true })
  expect(c.commands()).toHaveLength(1)
})
it('never inherits an earlier exception and lets SQL validate a previously saved receipt', async () => {
  const c = client({ receipt: true })
  expect(await retryScheduledPage(c.db, input)).toMatchObject({ ok: true })
  expect(evaluateVersionReadiness).not.toHaveBeenCalled()
  expect(c.commands()).toHaveLength(1)
})
it('does not apply publish readiness to an unpublish retry', async () => {
  const c = client({ action: 'unpublish' })
  expect(await retryScheduledPage(c.db, input)).toMatchObject({ ok: true })
  expect(evaluateVersionReadiness).not.toHaveBeenCalled()
  expect(c.commands()).toHaveLength(1)
})
