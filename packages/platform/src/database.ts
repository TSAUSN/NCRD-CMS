// Role-scoped database access (SPEC §3.2, §8).
//
// There are exactly three application connections and each one logs in as a
// different Postgres role. There is deliberately no "service" client here: a
// module that does not exist cannot be imported into an SSR path by accident,
// which is the difference between a rule and an enforced boundary.
//
//   asUser()   — the admin app. Runs in a transaction with the product user's
//                id set via SET LOCAL, so a pooled connection can never carry
//                one request's identity into the next.
//   asPublic() — the public renderer. Its role can only execute the three
//                public_api functions; it cannot name an authoring table.
//   asWorker() — job execution. Server-side, still unprivileged.
import { Pool, type PoolClient } from 'pg'
import { mapErrors } from '@cms/domain'
import { perfTrace } from './perf-trace.ts'

export type DatabaseRole = 'authenticated' | 'public' | 'worker' | 'migration'

const ENV_VAR: Record<DatabaseRole, string> = {
  authenticated: 'DATABASE_URL_AUTHENTICATED',
  public: 'DATABASE_URL_PUBLIC',
  worker: 'DATABASE_URL_WORKER',
  migration: 'DATABASE_URL',
}

const pools = new Map<DatabaseRole, Pool>()

export function connectionStringFor(role: DatabaseRole): string {
  const url = process.env[ENV_VAR[role]]
  if (!url) {
    throw new Error(
      `${ENV_VAR[role]} is not set. Each role connects as its own Postgres user; ` +
        'there is no shared credential to fall back to.',
    )
  }
  return url
}

/** Connections per process. A small hosted database allows few connections in
 * total, so each service may lower its pool with DATABASE_POOL_MAX. */
export function poolSizeFor(role: DatabaseRole, env: Record<string, string | undefined> = process.env): number {
  const fallback = role === 'public' ? 10 : 5
  const configured = env['DATABASE_POOL_MAX']
  if (configured === undefined || configured === '') return fallback
  const size = Number(configured)
  if (!Number.isInteger(size) || size < 1 || size > 50) {
    throw new Error('DATABASE_POOL_MAX must be a whole number from 1 to 50.')
  }
  return size
}

export function poolFor(role: DatabaseRole): Pool {
  let pool = pools.get(role)
  if (!pool) {
    pool = new Pool({ connectionString: connectionStringFor(role), max: poolSizeFor(role) })
    pools.set(role, pool)
  }
  return pool
}

async function connectForRequest(role: DatabaseRole) {
  const pool = poolFor(role)
  const trace = perfTrace()
  if (!trace) {
    const client = await pool.connect()
    return { client, release: () => client.release() }
  }
  trace.maxQueued = Math.max(trace.maxQueued, pool.waitingCount)
  const start = performance.now()
  const pending = pool.connect()
  trace.maxQueued = Math.max(trace.maxQueued, pool.waitingCount)
  const client = await pending.finally(() => {
    const waited = performance.now() - start
    trace.connectionWaitMs += waited
    trace.longestConnectionWaitMs = Math.max(trace.longestConnectionWaitMs, waited)
  })
  if (role === 'authenticated' || role === 'worker') trace.transactions++

  const originalQuery = client.query
  // Track only calls made on this checked-out client, and remove the probe
  // before handing the client back to the pool.
  client.query = new Proxy(originalQuery, {
    apply(target, receiver, args) {
      const start = performance.now()
      trace.statements++
      const recordTime = () => {
        trace.queryMs += performance.now() - start
      }
      const callback = args.at(-1)
      if (typeof callback === 'function') {
        args[args.length - 1] = function (this: unknown, ...result: unknown[]) {
          recordTime()
          return Reflect.apply(callback, this, result)
        }
      }
      try {
        const result = Reflect.apply(target, receiver, args)
        if (result instanceof Promise) return result.finally(recordTime)
        if (typeof callback !== 'function') recordTime()
        return result
      } catch (error) {
        recordTime()
        throw error
      }
    },
  })
  return {
    client,
    release: () => {
      client.query = originalQuery
      client.release()
    },
  }
}

export async function closePools(): Promise<void> {
  for (const pool of pools.values()) await pool.end()
  pools.clear()
}

export type RequestContext = { userId: string | null; requestId?: string }

/**
 * Run work as a product user, inside one transaction. Everything a command
 * needs — identity, request id, the change, its audit row, its outbox event —
 * commits together or not at all.
 */
export async function asUser<T>(
  ctx: RequestContext,
  fn: (client: PoolClient) => Promise<T>,
  options: { isolation?: 'repeatable read' } = {},
): Promise<T> {
  const { client, release } = await connectForRequest('authenticated')
  try {
    await client.query(options.isolation === 'repeatable read' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', ctx.userId ?? ''])
    if (ctx.requestId) await client.query('SELECT set_config($1, $2, true)', ['app.request_id', ctx.requestId])
    const result = await mapErrors(() => fn(client))
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    release()
  }
}

/** Read-only public rendering. No identity: this role has none to set. */
export async function asPublic<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const { client, release } = await connectForRequest('public')
  try {
    return await mapErrors(() => fn(client))
  } finally {
    release()
  }
}

export async function asWorker<T>(workerId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const { client, release } = await connectForRequest('worker')
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.worker_id', workerId])
    const result = await mapErrors(() => fn(client))
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    release()
  }
}
