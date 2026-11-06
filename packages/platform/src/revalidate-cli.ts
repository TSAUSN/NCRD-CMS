// `pnpm db:revalidate` — report, and with --apply, recompile. With --restyle it lists
// (and with --apply re-styles) versions whose template is unchanged but whose
// stylesheet the current compiler writes differently.
import { poolFor, closePools } from './database.ts'
import { formatRevalidation, revalidateDefinitions, revalidationExitCode } from './revalidate.ts'

const apply = process.argv.includes('--apply')
const restyle = process.argv.includes('--restyle')
const pool = poolFor('migration')
try {
  const outcomes = await revalidateDefinitions(pool, { apply, restyle })
  console.log(formatRevalidation(outcomes, { restyle }))
  if (!apply && outcomes.some(o => o.status !== 'needs-an-author')) {
    console.log('\nnothing was changed. re-run with --apply to rewrite them.')
  }
  // Failures count too. This asked only about `needs-an-author`, so a run in
  // which definitions actually failed to revalidate exited 0 and a scheduler
  // would have called it a success.
  process.exitCode = revalidationExitCode(outcomes)
} finally {
  await closePools()
}
