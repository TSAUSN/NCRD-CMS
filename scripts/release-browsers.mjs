// Each browser gets a complete, freshly seeded acceptance database. These
// journeys deliberately publish and restore content, so reusing Chromium's
// resulting state for Firefox or WebKit would invalidate their baseline.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const browser of ['chromium', 'firefox', 'webkit']) {
  console.log(`\nRelease acceptance: ${browser}, with a fresh isolated database.`)
  const result = spawnSync(
    'pnpm',
    ['test:e2e', `--project=${browser}`, `--output=test-results/release-${browser}`, ...process.argv.slice(2)],
    {
      cwd: root,
      env: { ...process.env, RELEASE_BROWSERS: '1' },
      stdio: 'inherit',
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
