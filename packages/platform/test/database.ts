// A migrated database of this package's own.
//
// The @cms/schema suite clones one template built by that package's global
// setup, and the template only exists for the duration of that run. @cms/platform
// has no vitest config of its own to hang a global setup off, and the tests
// here have to be on this side of the boundary anyway: they are the only place
// in the workspace where the compiler (@cms/renderer) and the database gates
// can be held against each other, because @cms/renderer depends on @cms/schema
// and importing it back from there would be a cycle.
//
// Migrating an empty database takes well under a tenth of a second, so each
// file builds its own and drops it. That also means every file here states its
// starting point instead of inheriting one.
import { randomUUID } from 'node:crypto'
import { Client, Pool } from 'pg'
import { migrate } from '@cms/schema/migrate'
// Side effect, and it has to happen before anything reads the environment.
// `pnpm --filter @cms/platform test` is a bare `vitest run` with no config to
// import the loader from, so the test files are where .env enters this package.
import '../../../scripts/load-env.ts'

/**
 * Read lazily rather than into a module constant.
 *
 * @cms/schema's harness captures TEST_DATABASE_URL at import time, which is
 * correct there because its vitest config loads .env before any test module is
 * evaluated. Here the loader is imported by the same module graph, and a
 * module-level capture would depend on import evaluation order to be right —
 * true today, and silently wrong the first time someone reorders an import.
 */
function adminUrl(): string {
  const url = process.env['TEST_DATABASE_URL']
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. These are not optional tests: revalidation rewrites the ' +
        'derived security artifacts of an already-published version, and a mock proves nothing ' +
        'about what the database does with them. Run `pnpm db:up`, then this suite again.',
    )
  }
  return url
}

/** A freshly migrated database, dropped when the file that made it is done. */
export class ScratchDatabase {
  readonly name: string
  readonly url: string
  private readonly pools: Pool[] = []

  private constructor(name: string, url: string) {
    this.name = name
    this.url = url
  }

  static async create(label: string): Promise<ScratchDatabase> {
    const name = `cms_p_${label.replace(/\W+/g, '_').slice(0, 20)}_${randomUUID().slice(0, 8)}`
    const admin = new Client({ connectionString: adminUrl() })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await admin.query(`CREATE DATABASE ${name}`)
    } finally {
      await admin.end()
    }
    const url = new URL(adminUrl())
    url.pathname = `/${name}`
    await migrate(url.toString())
    return new ScratchDatabase(name, url.toString())
  }

  /**
   * The connection revalidation actually uses.
   *
   * `poolFor('migration')` in production, which logs in as the role the
   * migrations ran as — the one that owns the schema. Testing this path as a
   * more privileged or less privileged role would be testing something else.
   */
  pool(): Pool {
    const pool = new Pool({ connectionString: this.url, max: 4 })
    this.pools.push(pool)
    return pool
  }

  async close(): Promise<void> {
    for (const pool of this.pools) await pool.end()
    this.pools.length = 0
    const admin = new Client({ connectionString: adminUrl() })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${this.name} WITH (FORCE)`)
    } finally {
      await admin.end()
    }
  }
}
