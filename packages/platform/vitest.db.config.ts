// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../../scripts/load-env.ts'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.db.test.ts'],
    // Each file creates and migrates its own scratch database; running them
    // sequentially keeps that cost predictable and the failures readable.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
