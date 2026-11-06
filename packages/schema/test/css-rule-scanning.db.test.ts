import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase } from './harness.ts'

let db: TestDatabase
beforeAll(async () => {
  db = await TestDatabase.create('css_rule_scanning')
})
afterAll(async () => {
  await db?.close()
})
describe('CSS rule scanning preserves the publication gate', () => {
  it.each([
    [null, []],
    ['', []],
    ['.a{color:red}.b{color:blue}', ['.a', '.b']],
    ['@media (width > 1px){.a{color:red}}', ['@media (width > 1px)', '.a']],
    ['.a{content:"{brace} and \\\"quote\\\""}.b{color:red}', ['.a', '.b']],
    [".a{content:'{brace} and \\'quote\\''}.b{color:red}", ['.a', '.b']],
    ['.escaped\\{name{color:red}', ['.escaped\\{name']],
    ['.a{content:"line\\\nnext"}.b{color:red}', ['.a', '.b']],
    ['.é{content:"Ω"}.日本語{color:red}', ['.é', '.日本語']],
    ['.a{content:"never closed}', null],
    [".a{content:'never closed}", null],
    ['.a{color:red}\\', ['.a']],
  ])('keeps the expected prelude for %j', async (css, expected) => {
    const value = await db.as(
      'owner',
      async c => (await c.query('SELECT app.css_rule_preludes($1) AS value', [css])).rows[0]!.value,
    )
    expect(value).toEqual(expected)
  })
  it('scans a long multibyte declaration within one second without relaxing validation', async () => {
    const value = await db.as('owner', async c => {
      await c.query('BEGIN')
      try {
        await c.query("SET LOCAL statement_timeout='1s'")
        return (
          await c.query('SELECT app.css_rule_preludes($1) AS value', ['.scope{content:"' + 'Ω'.repeat(50000) + '"}'])
        ).rows[0]!.value
      } finally {
        await c.query('ROLLBACK')
      }
    })
    expect(value).toEqual(['.scope'])
  })
})
