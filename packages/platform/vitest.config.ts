// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../../scripts/load-env.ts'

import { defineConfig } from 'vitest/config'

// Unit tests only. The cross-layer conformance tests need a real database —
// they are the only place the renderer's CSS policy and the SQL gate are both
// reachable — so they have their own config and their own command, and a green
// `pnpm test` never implies the database was consulted (SPEC §9).
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'], exclude: ['test/**/*.db.test.ts'] },
})
