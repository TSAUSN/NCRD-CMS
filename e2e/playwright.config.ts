// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../scripts/load-env.ts'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { demoNeedsBuild } from '../scripts/demo-build.mjs'
import { e2eTarget } from './test-target.ts'
import { E2E_PORTS } from './test-ports.ts'

// The browsers drive `next start`, which serves whatever build is on disk.
// Refuse to report results for source that was never built.
if (
  process.env['E2E_ALLOW_STALE_BUILD'] !== '1' &&
  demoNeedsBuild(join(dirname(fileURLToPath(import.meta.url)), '..'))
) {
  throw new Error(
    'The admin or site build is older than the source. Run `pnpm --filter admin --filter site build` first.',
  )
}

// Playwright drives the real apps against a real seeded Postgres (SPEC §9).
// Everything here runs against a database of its own — `cms_e2e` — so a run
// never disturbs the development data and never depends on it either.

const { database: DB, host: HOST, port: PORT } = e2eTarget()

const { admin: ADMIN_PORT, site: SITE_PORT } = E2E_PORTS

const env = {
  DATABASE_URL: `postgres://cms:cms@${HOST}:${PORT}/${DB}`,
  DATABASE_URL_AUTHENTICATED: `postgres://cms_admin_app:devpassword@${HOST}:${PORT}/${DB}`,
  DATABASE_URL_PUBLIC: `postgres://cms_site_app:devpassword@${HOST}:${PORT}/${DB}`,
  DATABASE_URL_WORKER: `postgres://cms_worker_app:devpassword@${HOST}:${PORT}/${DB}`,
  AUTH_SECRET: 'e2e-secret-value-not-used-in-production',
  AUTH_PROVIDER: 'local',
  CMS_LOCAL_TEST_MODE: 'true',
  ADMIN_ORIGIN: `http://127.0.0.1:${ADMIN_PORT}`,
  PUBLIC_SITE_PORT: String(SITE_PORT),
  MAILER_PROVIDER: 'recording',
  // Domain journeys replace only the external service; the demo without this
  // explicit test provider must explain that custom domains are unavailable.
  DOMAIN_PROVIDER: 'fake',
  // Synthetic schedule specs create their own scoped heartbeat and never run
  // a scheduler. This activates only the isolated local acceptance process.
  SCHEDULING_ENABLED: 'true',
  SCHEDULING_MONITORING_READY: 'true',
  TRUST_PROXY_HEADERS: 'false',
  APP_VERSION: 'e2e',
  NODE_ENV: 'production',
}

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  // Serial: the specs share one seeded site, and an editor loop that raced
  // another editor loop would be testing the CAS conflict by accident.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${ADMIN_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Chromium is the required per-commit gate (SPEC §9).
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox and WebKit run the complete suite at the step-end release gate.
    // They run only when a release check asks (RELEASE_BROWSERS=1),
    // so a per-change run stays Chromium-only.
    ...(process.env['RELEASE_BROWSERS'] === '1'
      ? [
          {
            name: 'firefox',
            use: {
              ...devices['Desktop Firefox'],
              launchOptions: process.env['CMS_E2E_FIREFOX_EXECUTABLE']
                ? { executablePath: process.env['CMS_E2E_FIREFOX_EXECUTABLE'] }
                : {},
            },
          },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],

  webServer: [
    {
      command: 'pnpm --filter admin start --hostname 127.0.0.1',
      port: ADMIN_PORT,
      cwd: '..',
      // Reusing a running server could test another checkout's build.
      reuseExistingServer: process.env['E2E_REUSE_SERVER'] === '1',
      env: { ...env, PORT: String(ADMIN_PORT) },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter site start --hostname 127.0.0.1',
      port: SITE_PORT,
      cwd: '..',
      reuseExistingServer: process.env['E2E_REUSE_SERVER'] === '1',
      env: { ...env, PORT: String(SITE_PORT) },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})

export const PORTS = { admin: ADMIN_PORT, site: SITE_PORT }
export const E2E_ENV = env
