// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../../scripts/load-env.ts'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.db.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Each file clones the template; running files sequentially keeps the
    // clone/drop cost predictable and makes failures easy to read.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
