// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../../scripts/load-env.ts'

import { defineConfig } from 'vitest/config'

// Unit tests only. Database policy tests have their own config and their own
// command, so a green `pnpm test` never implies the database was consulted.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
