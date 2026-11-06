import { deepStrictEqual, throws } from 'node:assert/strict'
import { test } from 'node:test'
import { e2eTarget } from './test-target.ts'

test('defaults to the isolated local E2E database', () => {
  deepStrictEqual(e2eTarget({}), { database: 'cms_e2e', host: '127.0.0.1', port: '54329' })
  deepStrictEqual(e2eTarget({ E2E_DATABASE: 'cms_e2e_cloud_2', E2E_PG_HOST: 'localhost', E2E_PG_PORT: '54330' }), {
    database: 'cms_e2e_cloud_2',
    host: 'localhost',
    port: '54330',
  })
})

test('refuses non-test databases, SQL identifiers and truncation collisions before connecting', () => {
  for (const database of [
    'postgres',
    'cms_dev',
    'cms_production',
    'cms_e2e_',
    'cms_e2e;DROP DATABASE cms_dev',
    'cms_e2e"',
    'cms_e2e_test-name',
    'cms_e2e_UPPER',
    '',
    `cms_e2e_${'x'.repeat(56)}`,
  ]) {
    throws(() => e2eTarget({ E2E_DATABASE: database }), /E2E_DATABASE/)
  }
})

test('refuses remote hosts and injected connection-string components', () => {
  for (const host of ['production.example.org', '127.0.0.1.evil.test', 'localhost:5432', '127.0.0.1/db?x=', '']) {
    throws(() => e2eTarget({ E2E_PG_HOST: host }), /E2E_PG_HOST/)
  }
  for (const port of ['0', '65536', '-1', '5432/db', '5432?sslmode=disable', '', ' 5432']) {
    throws(() => e2eTarget({ E2E_PG_PORT: port }), /E2E_PG_PORT/)
  }
})
