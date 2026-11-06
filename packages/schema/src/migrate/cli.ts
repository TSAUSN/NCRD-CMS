// `pnpm --filter @cms/schema migrate`, and the container's `migrate` command.
import { migrate } from './index.ts'

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const results = await migrate(url, { log: m => console.log(m) })
const fresh = results.filter(r => !r.alreadyApplied)
console.log(
  fresh.length === 0
    ? `up to date (${results.length} migrations)`
    : `applied ${fresh.length} of ${results.length}: ${fresh.map(r => r.name).join(', ')}`,
)
