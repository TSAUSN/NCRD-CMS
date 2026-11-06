import { Pool } from 'pg'
import { runDueSchedules } from '../../apps/worker/src/handlers.ts'
import { e2eTarget } from '../test-target.ts'

// This runner is restricted to the validated disposable browser-test database.
const target = e2eTarget()
const pool = new Pool({
  connectionString: `postgres://cms_worker_app:devpassword@${target.host}:${target.port}/${target.database}`,
})
try {
  console.log(JSON.stringify(await runDueSchedules(pool, 'e2e-supersession', { max: 1 })))
} finally {
  await pool.end()
}
