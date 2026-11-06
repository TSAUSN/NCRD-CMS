import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import { startRequestWorkerServer } from './request-server.ts'

it('awaits work before acknowledging, refuses overlap/payloads, and can process a later pass', async () => {
  let complete!: () => void
  let started!: () => void
  const entered = new Promise<void>(resolve => {
    started = resolve
  })
  const work = new Promise<void>(resolve => {
    complete = resolve
  })
  const run = vi.fn(async () => {
    started()
    await work
    return { ok: true, detail: { done: true } }
  })
  const host = startRequestWorkerServer(0, run)
  await once(host.server, 'listening')
  const base = `http://127.0.0.1:${(host.server.address() as AddressInfo).port}`
  try {
    expect((await fetch(`${base}/health`)).status).toBe(200)
    expect(run).not.toHaveBeenCalled()
    expect((await fetch(`${base}/run`)).status).toBe(404)
    expect((await fetch(`${base}/run`, { method: 'POST', body: '{}' })).status).toBe(400)
    const first = fetch(`${base}/run`, { method: 'POST' })
    await entered
    expect((await fetch(`${base}/run`, { method: 'POST' })).status).toBe(409)
    complete()
    expect(await (await first).json()).toEqual({ done: true })
    expect((await fetch(`${base}/run`, { method: 'POST' })).status).toBe(200)
    expect(run).toHaveBeenCalledTimes(2)
  } finally {
    complete()
    host.stop()
    host.server.closeAllConnections()
  }
})

it('returns a failed status without reflecting internal provider errors', async () => {
  const host = startRequestWorkerServer(0, async () => {
    throw new Error('private connection details')
  })
  await once(host.server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${(host.server.address() as AddressInfo).port}/run`, {
      method: 'POST',
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'worker-pass-failed' })
  } finally {
    host.stop()
    host.server.closeAllConnections()
  }
})
