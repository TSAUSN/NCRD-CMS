// Load the repository's .env for any process that needs it, without ever
// overriding a variable the environment already set.
//
// That precedence is the whole point: CI supplies DATABASE_URL_* and
// TEST_DATABASE_URL directly, and a stray .env on a runner must not silently
// replace them. `process.loadEnvFile` has exactly this behaviour — an existing
// process.env entry wins — which is why it is used rather than a dotenv package
// that would need configuring to behave the same way.
//
// Package.json entrypoints use `node --env-file-if-exists=../../.env` instead,
// which has the same precedence. This module exists for the places that cannot
// pass a node flag: vitest configs, the Playwright config, and next.config.ts.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let loaded = false

function loadRepoEnv(): void {
  if (loaded) return
  loaded = true
  const envFile = join(REPO_ROOT, '.env')
  // A missing .env is normal — CI has none and needs none.
  if (!existsSync(envFile)) return
  process.loadEnvFile(envFile)
}

loadRepoEnv()
