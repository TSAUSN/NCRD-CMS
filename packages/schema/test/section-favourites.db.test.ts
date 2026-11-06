import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('section_favourites')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
const set = (user: string | null, site: string, section: string, favourite: boolean | null) =>
  db.asUser(user, client => client.query('SELECT app.set_section_favourite($1,$2,$3)', [site, section, favourite]))

describe('personal section favourites', () => {
  it('persists idempotently, belongs only to its user and site, and can be removed', async () => {
    await set(s.contributorA, s.siteA, s.heroDefId, true)
    await set(s.contributorA, s.siteA, s.heroDefId, true)
    expect((await db.asUser(s.contributorA, client => client.query('SELECT * FROM section_favourites'))).rows).toEqual([
      expect.objectContaining({ user_id: s.contributorA, site_id: s.siteA, section_def_id: s.heroDefId }),
    ])
    for (const user of [s.editorA, s.editorB, s.superAdmin, s.disabled, null]) {
      expect((await db.asUser(user, client => client.query('SELECT * FROM section_favourites'))).rows).toEqual([])
    }
    await set(s.contributorA, s.siteA, s.heroDefId, false)
    expect((await db.asUser(s.contributorA, client => client.query('SELECT * FROM section_favourites'))).rows).toEqual(
      [],
    )
  })

  it('refuses anonymous, disabled, wrong-site, missing definition and malformed choices', async () => {
    for (const user of [null, s.disabled, s.editorB])
      await expectSqlState(set(user, s.siteA, s.heroDefId, true), 'CMS02')
    await expectSqlState(set(s.editorA, s.siteA, '00000000-0000-0000-0000-000000000099', true), 'CMS04')
    await expectSqlState(set(s.editorA, s.siteA, s.heroDefId, null), 'CMS04')
    await db.as('owner', client =>
      client.query("UPDATE section_defs SET scope='site',site_id=$1 WHERE id=$2", [s.siteB, s.heroDefId]),
    )
    await expectSqlState(set(s.editorA, s.siteA, s.heroDefId, true), 'CMS04')
    await db.as('owner', client =>
      client.query("UPDATE section_defs SET scope='global',site_id=NULL WHERE id=$1", [s.heroDefId]),
    )
  })

  it('removes visibility immediately after membership revocation and denies direct or runtime writes', async () => {
    await set(s.contributorA, s.siteA, s.heroDefId, true)
    await db.as('owner', client =>
      client.query('DELETE FROM site_memberships WHERE user_id=$1 AND site_id=$2', [s.contributorA, s.siteA]),
    )
    expect((await db.asUser(s.contributorA, client => client.query('SELECT * FROM section_favourites'))).rows).toEqual(
      [],
    )
    await expectSqlState(set(s.contributorA, s.siteA, s.heroDefId, false), 'CMS02')
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('INSERT INTO section_favourites(user_id,site_id,section_def_id) VALUES($1,$2,$3)', [
          s.editorA,
          s.siteA,
          s.heroDefId,
        ]),
      ),
      '42501',
    )
    for (const role of ['public', 'worker'] as const) {
      await expectSqlState(
        db.as(role, client => client.query('SELECT * FROM public.section_favourites')),
        '42501',
      )
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.set_section_favourite($1,$2,true)', [s.siteA, s.heroDefId])),
        '42501',
      )
    }
  })
})
