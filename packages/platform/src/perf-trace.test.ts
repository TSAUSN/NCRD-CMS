import { expect, it } from 'vitest'
import { countPerfAuth, measurePerfRender, perfTrace, runPerfTrace, type PerfTrace } from './perf-trace.ts'

const counters = (): PerfTrace => ({
  transactions: 0,
  statements: 0,
  connectionWaitMs: 0,
  longestConnectionWaitMs: 0,
  maxQueued: 0,
  queryMs: 0,
  authChecks: 0,
  outboundAuthCalls: 0,
  renderMs: 0,
})

it('keeps interleaved request counts separate and leaves disabled traces empty', async () => {
  const previous = process.env['CMS_PERF_TRACE']
  try {
    const left = counters()
    const right = counters()
    process.env['CMS_PERF_TRACE'] = '1'
    const first = runPerfTrace(left, async () => {
      await Promise.resolve()
      countPerfAuth('authChecks')
      expect(perfTrace()).toBe(left)
      return measurePerfRender(() => 'left')
    })
    const second = runPerfTrace(right, async () => {
      countPerfAuth('outboundAuthCalls')
      await Promise.resolve()
      expect(perfTrace()).toBe(right)
      return measurePerfRender(() => 'right')
    })
    expect(await Promise.all([first, second])).toEqual(['left', 'right'])
    expect(left).toMatchObject({ authChecks: 1, outboundAuthCalls: 0 })
    expect(right).toMatchObject({ authChecks: 0, outboundAuthCalls: 1 })
    expect(perfTrace()).toBeUndefined()
    delete process.env['CMS_PERF_TRACE']
    const disabled = counters()
    expect(
      runPerfTrace(disabled, () => {
        countPerfAuth('authChecks')
        expect(perfTrace()).toBeUndefined()
        return measurePerfRender(() => 42)
      }),
    ).toBe(42)
    expect(disabled).toEqual(counters())
  } finally {
    if (previous === undefined) delete process.env['CMS_PERF_TRACE']
    else process.env['CMS_PERF_TRACE'] = previous
  }
})
