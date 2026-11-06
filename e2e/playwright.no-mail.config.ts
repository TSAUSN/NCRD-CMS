import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

// Exercise the deployed no-mail mode through real UI/server/SQL without changing
// the normal invitation suite or making any test conditional or skipped.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'no-mail.spec.ts',
  webServer: (Array.isArray(base.webServer) ? base.webServer : [base.webServer])
    .filter(server => server !== undefined)
    .map(server => ({
      ...server,
      env: { ...server.env, INVITATION_EMAIL_ENABLED: 'false' },
    })),
})
