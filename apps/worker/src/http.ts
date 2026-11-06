import { closePools, configuredMonitor } from '@cms/platform'
import { readConfig } from './config.ts'
import { createWorkerRuntime } from './runtime.ts'
import { runWorkerPass } from './pass.ts'
import { reportQueueHealth } from './monitoring.ts'
import { startRequestWorkerServer } from './request-server.ts'

const config = readConfig()
const monitor = configuredMonitor()
const server = startRequestWorkerServer(Number(process.env['PORT'] ?? 8080), async signal => {
  const runtime = createWorkerRuntime(config)
  try {
    const result = await runWorkerPass(runtime.pool, config, runtime.handlers, {
      seconds: Number(process.env['WORKER_PASS_SECONDS'] ?? 35),
      signal,
    })
    await reportQueueHealth(monitor, result.health)
    console.log(JSON.stringify({ event: 'worker.pass.complete', workerId: config.workerId, ...result }))
    return { ok: result.outbox.dead === 0 && result.schedules.failed === 0, detail: result }
  } catch (error) {
    console.error(JSON.stringify({ event: 'worker.pass.failed', error: (error as Error).message }))
    throw error
  } finally {
    await runtime.screenshots.close().catch(() => {})
    await closePools()
  }
})
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.stop()
    // Unfinished work remains protected by its expiring lease on termination.
    setTimeout(() => process.exit(0), 8_000).unref()
  })
