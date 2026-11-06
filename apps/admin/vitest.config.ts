// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../../scripts/load-env.ts'

import { defineConfig } from 'vitest/config'

// Unit tests only. The database suites have their own config and their own
// command, so a green `pnpm test` never implies the database was consulted.
export default defineConfig({
  // Next preserves JSX for its own compiler. Unit tests use Vite's Oxc
  // transform instead, so TSX component smoke tests need the React runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
