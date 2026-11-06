// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
//
// This package needs it for V1_ROOT: the V1 checkout is a separate, licensed
// repository that lives wherever an operator put it, so its path cannot be a
// tracked constant. No V1_ROOT means the catalogue suites skip, a V1_ROOT that
// names something other than a V1 checkout means they fail, and only a V1_ROOT
// that names one runs them — `catalogue.test.ts` makes that decision and says
// why in full at the top of the file.
import '../../scripts/load-env.ts'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Every test by name, rather than a count, because in this package a count
    // hides the thing worth seeing. The catalogue suites read a licensed
    // checkout that exists on one machine and skip everywhere else, and the
    // default reporter prints a skipped test as a number in a summary line —
    // indistinguishable, to a reader, from a test that ran and passed. Verbose
    // output puts the suite names on screen, and a skipped suite carries the
    // reason it skipped in its own name.
    reporters: ['verbose'],
  },
})
