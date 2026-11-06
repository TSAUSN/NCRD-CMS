import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { TestDatabase } from './harness.ts'
// The deployment command uses this same transaction implementation.
import { bootstrapHostedOwner } from '../../../scripts/bootstrap-hosted-owner.mjs'

describe('first hosted installation owner', () => {
  let db: TestDatabase
  beforeAll(async () => {
    db = await TestDatabase.create('hosted_first_owner')
  })
  afterAll(async () => {
    await db.close()
  })

  it('creates one real owner without a test identity, safely repeats, and refuses a different owner', async () => {
    await db.as('owner', async client => {
      const first = await bootstrapHostedOwner(client, 'Owner@example.org', 'Staging Owner')
      expect(first.status).toBe('initialized')
      expect(await bootstrapHostedOwner(client, 'owner@example.org', 'Staging Owner')).toEqual({
        status: 'already-initialized',
        userId: first.userId,
      })
      await expect(bootstrapHostedOwner(client, 'other@example.org', 'Other')).rejects.toThrow('owner already exists')
      const people = (await client.query('SELECT id,email,auth_subject FROM app_users')).rows
      expect(people).toEqual([{ id: first.userId, email: 'owner@example.org', auth_subject: null }])
      expect((await client.query('SELECT role FROM global_roles WHERE user_id=$1', [first.userId])).rows).toEqual([
        { role: 'super_admin' },
      ])
    })
  })

  it('only the subsequently verified owner identity can attach and resolve the account', async () => {
    await db.asUser(null, async client => {
      expect(
        (await client.query("SELECT * FROM app.resolve_session('verified-subject','unknown@example.org')")).rows,
      ).toEqual([])
      await client.query("SELECT app.attach_auth_subject('owner@example.org','verified-subject')")
      expect(
        (await client.query("SELECT * FROM app.resolve_session('verified-subject','owner@example.org')")).rows[0]
          .is_super_admin,
      ).toBe(true)
    })
    await db.asUser(null, async client => {
      await expect(
        client.query("SELECT app.attach_auth_subject('owner@example.org','different-subject')"),
      ).rejects.toMatchObject({ code: 'CMS04' })
    })
  })

  it('refuses development identities and cannot silently grant a second administrator', async () => {
    await db.as('owner', async client => {
      await expect(bootstrapHostedOwner(client, 'admin@example.test', 'Demo')).rejects.toThrow('real owner')
      await expect(bootstrapHostedOwner(client, 'owner@example.org', 'Bad\nName')).rejects.toThrow('real owner')
      expect(Number((await client.query('SELECT count(*) AS n FROM global_roles')).rows[0].n)).toBe(1)
    })
  })

  it('refuses to bootstrap over an occupied installation even when no owner is present', async () => {
    const occupied = await TestDatabase.create('hosted_occupied')
    try {
      await occupied.as('owner', async client => {
        await client.query("INSERT INTO app_users(email,display_name) VALUES('existing@example.org','Existing person')")
        await expect(bootstrapHostedOwner(client, 'new-owner@example.org', 'New owner')).rejects.toThrow(
          'empty installation',
        )
        expect((await client.query('SELECT * FROM global_roles')).rowCount).toBe(0)
        expect((await client.query('SELECT email FROM app_users')).rows).toEqual([{ email: 'existing@example.org' }])
      })
    } finally {
      await occupied.close()
    }
  })
})
