import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { drainOutbox } from '../src/handlers.ts'
import { createSiteHostingHandler } from '../src/site-hosting.ts'

let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('site_hosting')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

it('durably provisions the owning site address, ignores payload overrides, and exposes status only to members', async () => {
  await db.as('owner', async c => {
    await c.query('DELETE FROM outbox')
    await c.query("UPDATE sites SET staging_hostname='c123456789012-aabbccddeeff0011.web.app' WHERE id=$1", [s.siteA])
    await c.query("UPDATE outbox SET payload=jsonb_build_object('site_id',$1::text)", [s.siteB])
  })
  const status = (user: string, id: string) =>
    db.asUser(user, async c => (await c.query('SELECT app.site_hosting_status($1) AS status', [id])).rows[0].status)
  expect(await status(s.editorA, s.siteA)).toBe('preparing')
  expect(await status(s.editorA, s.siteB)).toBeNull()
  const ensureSite = vi.fn().mockResolvedValue(undefined)
  const handler = createSiteHostingHandler(db.pool('worker'), 'hosting-worker', { ensureSite })
  expect(
    (await drainOutbox(db.pool('worker'), 'hosting-worker', new Map([['site.hosting_requested', handler]]))).delivered,
  ).toBe(1)
  expect(ensureSite).toHaveBeenCalledWith('c123456789012-aabbccddeeff0011.web.app')
  expect(await status(s.editorA, s.siteA)).toBe('ready')
  await expectSqlState(
    db.as('public', c => c.query("SELECT app.site_hosting_job(1,'00000000-0000-0000-0000-000000000000')")),
    '42501',
  )
})
