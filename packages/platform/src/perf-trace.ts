import { AsyncLocalStorage } from 'node:async_hooks'

export type PerfTrace = {
  transactions: number
  statements: number
  connectionWaitMs: number
  longestConnectionWaitMs: number
  maxQueued: number
  queryMs: number
  authChecks: number
  outboundAuthCalls: number
  renderMs: number
}

// A production build can bundle this module separately for several routes.
// The loopback trace runner and those routes must see the same request scope.
const key = Symbol.for('cms.performance.request-trace')
const scopes = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<PerfTrace> }

export function perfTrace(): PerfTrace | undefined {
  return process.env['CMS_PERF_TRACE'] === '1' ? scopes[key]?.getStore() : undefined
}

export function runPerfTrace<T>(trace: PerfTrace, run: () => T): T {
  if (process.env['CMS_PERF_TRACE'] !== '1') return run()
  return (scopes[key] ??= new AsyncLocalStorage()).run(trace, run)
}

export function countPerfAuth(check: 'authChecks' | 'outboundAuthCalls'): void {
  const trace = perfTrace()
  if (trace) trace[check]++
}

export function measurePerfRender<T>(render: () => T): T {
  const trace = perfTrace()
  if (!trace) return render()
  const start = performance.now()
  try {
    return render()
  } finally {
    trace.renderMs += performance.now() - start
  }
}
