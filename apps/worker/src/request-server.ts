import { createServer } from 'node:http'

/** This endpoint must be deployed behind Cloud Run IAM, with only the scheduler
 * and operators as invokers. It accepts no caller-controlled job arguments. */
export function startRequestWorkerServer(
  port: number,
  run: (signal: AbortSignal) => Promise<{ ok: boolean; detail: unknown }>,
) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid worker HTTP port')
  let running = false
  let stopping = false
  let active: AbortController | null = null
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown) => {
      if (response.destroyed) return
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(value))
    }
    if (request.method === 'GET' && request.url === '/health') return reply(stopping ? 503 : 200, { ok: !stopping })
    if (request.method !== 'POST' || request.url !== '/run') return reply(404, { error: 'not-found' })
    if (Number(request.headers['content-length'] ?? 0) !== 0 || request.headers['transfer-encoding'])
      return reply(400, { error: 'no-payload-accepted' })
    if (stopping) return reply(503, { error: 'stopping' })
    if (running) return reply(409, { error: 'pass-already-running' })
    running = true
    const controller = new AbortController()
    active = controller
    response.on('close', () => {
      if (!response.writableFinished) controller.abort()
    })
    try {
      const result = await run(controller.signal)
      reply(result.ok ? 200 : 503, result.detail)
    } catch {
      // Provider errors are logged by the role, not reflected with secrets or
      // raw database details to an HTTP caller.
      reply(500, { error: 'worker-pass-failed' })
    } finally {
      running = false
      active = null
    }
  })
  server.requestTimeout = 180_000
  server.headersTimeout = 10_000
  server.listen(port, '0.0.0.0')
  return {
    server,
    stop() {
      stopping = true
      active?.abort()
      server.close()
    },
  }
}
