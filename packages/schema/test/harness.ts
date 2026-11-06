// Database integration harness (SPEC §9): every assertion below runs over a
// real connection as a real Postgres role. Nothing here mocks a policy
// predicate — a test that passes because a fake said "allowed" would prove
// exactly nothing about what the database does.
//
// Isolation is per test file: the global setup builds one migrated template
// database and each file clones it, so files cannot see each other's rows and
// concurrency tests get genuinely separate connections.
import { randomUUID } from 'node:crypto'
import { Client, Pool, type PoolClient } from 'pg'

export const ADMIN_URL = process.env['TEST_DATABASE_URL'] ?? ''
export const TEMPLATE_DB = 'cms_test_template'

export type Role = 'owner' | 'authenticated' | 'public' | 'worker'

/**
 * The readiness arguments a test states on its own behalf: policy version 1, no
 * override, and a findings list that is empty because the test knows this
 * fixture page is ready.
 *
 * `app.publish_page` has no readiness defaults any more (migration 0011), and
 * this is deliberately not one. A default answers "was this checked?" with a
 * silent yes on the caller's behalf; a named constant makes the callsite say it,
 * and says in one place what the claim is. Tests that publish content whose
 * readiness is actually in question run the real evaluator instead — see
 * `scheduled-readiness.db.test.ts`.
 */
export const CHECKED_CLEAN = [1, null, '[]'] as const

const LOGIN: Record<Role, { user: string; password: string }> = {
  owner: { user: 'cms', password: 'cms' },
  authenticated: { user: 'cms_admin_app', password: 'devpassword' },
  public: { user: 'cms_site_app', password: 'devpassword' },
  worker: { user: 'cms_worker_app', password: 'devpassword' },
}

export function requireTestDatabase(): string {
  if (!ADMIN_URL) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Database policy tests are not optional: run `pnpm db:up` ' +
        'then `pnpm test:db`. A green unit run does not prove any of these behaviours.',
    )
  }
  return ADMIN_URL
}

function urlFor(role: Role, database: string): string {
  const base = new URL(requireTestDatabase())
  const { user, password } = LOGIN[role]
  return `postgres://${user}:${password}@${base.hostname}:${base.port}/${database}`
}

/** A disposable clone of the migrated template, unique to one test file. */
export class TestDatabase {
  readonly name: string
  private pools = new Map<Role, Pool>()

  private constructor(name: string) {
    this.name = name
  }

  static async create(label: string): Promise<TestDatabase> {
    const name = `cms_t_${label.replace(/\W+/g, '_').slice(0, 20)}_${randomUUID().slice(0, 8)}`
    const admin = new Client({ connectionString: requireTestDatabase() })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`)
    } finally {
      await admin.end()
    }
    return new TestDatabase(name)
  }

  pool(role: Role): Pool {
    let pool = this.pools.get(role)
    if (!pool) {
      pool = new Pool({ connectionString: urlFor(role, this.name), max: 4 })
      this.pools.set(role, pool)
    }
    return pool
  }

  /** Run as a role with no product identity attached. */
  async as<T>(role: Role, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool(role).connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  }

  /**
   * Run inside a transaction that carries a product identity, exactly the way
   * the application does it: SET LOCAL, so a pooled connection can never leak
   * one request's identity into the next.
   */
  async asUser<T>(
    userId: string | null,
    fn: (client: PoolClient) => Promise<T>,
    role: Role = 'authenticated',
  ): Promise<T> {
    const client = await this.pool(role).connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId ?? ''])
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async asWorker<T>(workerId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool('worker').connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT set_config($1, $2, true)', ['app.worker_id', workerId])
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    for (const pool of this.pools.values()) await pool.end()
    this.pools.clear()
    const admin = new Client({ connectionString: requireTestDatabase() })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${this.name} WITH (FORCE)`)
    } finally {
      await admin.end()
    }
  }
}

/** Assert a statement fails, and fail loudly with the SQLSTATE when it does not. */
export async function expectSqlState(promise: Promise<unknown>, ...codes: string[]): Promise<string> {
  try {
    await promise
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'unknown'
    if (codes.length > 0 && !codes.includes(code)) {
      throw new Error(`expected SQLSTATE ${codes.join('|')} but got ${code}: ${(error as Error).message}`)
    }
    return code
  }
  throw new Error(`expected the statement to be refused with ${codes.join('|') || 'an error'}, but it succeeded`)
}
