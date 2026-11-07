import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Server } from 'node:http'
import { runPerfTrace } from '../../packages/platform/src/perf-trace.ts'

const { CMS_PERF_APP: appName, CMS_PERF_TRACE_FILE: file } = process.env
if (process.env.CMS_PERF_TRACE !== '1' || !file || !['admin', 'site'].includes(appName))
  throw Error('The local Next.js trace requires a fixture application and private trace output.')

// Preloaded only by the loopback fixture runner. Wrap the HTTP request
// dispatch so the real Next.js CLI keeps its own config and startup path.
const originalEmit = Server.prototype.emit
Server.prototype.emit = function (event, ...args) {
  if (event !== 'request') return Reflect.apply(originalEmit, this, [event, ...args])
  const [request, response] = args
  const trace = {
    id: randomUUID(),
    app: appName,
    method: request.method,
    kind: request.headers.rsc === '1' ? 'rsc' : request.headers['next-action'] ? 'action' : 'http',
    transactions: 0,
    statements: 0,
    connectionWaitMs: 0,
    longestConnectionWaitMs: 0,
    maxQueued: 0,
    queryMs: 0,
    authChecks: 0,
    outboundAuthCalls: 0,
    renderMs: 0,
  }
  const start = performance.now()
  const record = () => {
    response.off('finish', record)
    response.off('close', record)
    // Neither URLs nor SQL, tokens or cookies are written to the trace.
    appendFileSync(
      file,
      JSON.stringify({
        ...trace,
        durationMs: performance.now() - start,
        status: response.statusCode,
        complete: response.writableFinished,
      }) + '\n',
      { mode: 0o600 },
    )
  }
  response.once('finish', record)
  response.once('close', record)
  response.setHeader('x-cms-perf-request', trace.id)
  return runPerfTrace(trace, () => Reflect.apply(originalEmit, this, [event, ...args]))
}
