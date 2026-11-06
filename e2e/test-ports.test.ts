import { deepStrictEqual, throws } from 'node:assert/strict'
import { test } from 'node:test'
import { e2ePorts } from './test-ports.ts'

test('keeps default test ports and accepts an isolated worktree pair', () => {
  deepStrictEqual(e2ePorts({}), { admin: 3200, site: 3201 })
  deepStrictEqual(e2ePorts({ E2E_ADMIN_PORT: '3300', E2E_SITE_PORT: '3301' }), { admin: 3300, site: 3301 })
})
test('refuses retained demo ports, collisions and invalid connection-string components', () => {
  for (const key of ['E2E_ADMIN_PORT', 'E2E_SITE_PORT'])
    for (const value of ['3000', '3001', '54329', '0', '65536', '-1', '3301/path', '', ' 3301'])
      throws(() => e2ePorts({ [key]: value }), /dedicated TCP port/)
  throws(() => e2ePorts({ E2E_ADMIN_PORT: '3300', E2E_SITE_PORT: '3300' }), /must differ/)
})
