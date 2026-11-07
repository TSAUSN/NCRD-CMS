import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

test('links that open a canvas use document navigation', () => {
  const root = resolve(import.meta.dirname, '../..')
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'canvas-links.mjs'), root], {
    encoding: 'utf8',
  })
  assert.ifError(result.error)
  const violations = JSON.parse(result.stdout)
  assert.deepEqual(violations, [], 'Use GuardedLink for these canvas destinations:')
  assert.equal(result.status, 0, result.stderr)
})
