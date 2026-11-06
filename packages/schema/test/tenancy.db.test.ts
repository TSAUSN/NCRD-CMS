// M0 exit criteria, proven at the database as real roles (SPEC §4, §8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('tenancy')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

describe('the connection the admin app uses is not privileged', () => {
  it('is neither superuser nor BYPASSRLS — the prototype failed exactly here', async () => {
    const { rows } = await db.as('authenticated', c =>
      c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      ),
    )
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
  })

  it('sees nothing at all without a product identity on the transaction', async () => {
    const { rows } = await db.asUser(null, c => c.query('SELECT id FROM sites'))
    expect(rows).toHaveLength(0)
  })
})

describe('an invited editor is scoped to one site', () => {
  it('reads their own site and cannot see the other one exists', async () => {
    const { rows } = await db.asUser(s.editorA, c => c.query<{ slug: string }>('SELECT slug FROM sites'))
    expect(rows.map(r => r.slug)).toEqual(['site-a'])
  })

  it('a wrong-site read returns zero rows rather than an error — no existence oracle', async () => {
    const { rows } = await db.asUser(s.editorA, c => c.query('SELECT id FROM sites WHERE id = $1', [s.siteB]))
    expect(rows).toHaveLength(0)
  })

  it('cannot read another site’s page versions even by naming the id directly', async () => {
    const pageB = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteB, 'secret', 'Secret']))
          .rows[0]!.id,
    )
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [pageB, 0, heroContent(s.heroDefId, 'Site B private'), '{}']),
    )

    const { rows } = await db.asUser(s.editorA, c =>
      c.query('SELECT content FROM page_versions WHERE page_id = $1', [pageB]),
    )
    expect(rows).toHaveLength(0)
  })
})

describe('wrong-site writes fail at the database', () => {
  it('refuses a comment filed against a site the author is not a member of', async () => {
    const pageB = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteB,
            'comment-target',
            'Comment target',
          ])
        ).rows[0]!.id,
    )
    // The command scopes the named page through the current database identity,
    // so a foreign page and a missing one are the same answer.
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.add_page_comment($1,$2,$3,$4)', [pageB, null, 'trying', '[]'])),
      'CMS03',
    )
  })

  it('allows the same write on their own site', async () => {
    const target = await db.asUser(s.editorA, async c => {
      const page = await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
        s.siteA,
        'comment-own-site',
        'Comment own site',
      ])
      const pageId = page.rows[0]!.id
      const draft = await c.query<{ revision: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        pageId,
        0,
        heroContent(s.heroDefId),
        '{}',
      ])
      const review = await c.query<{ version_id: string }>('SELECT * FROM app.submit_page_for_review($1,$2,$3)', [
        pageId,
        draft.rows[0]!.revision,
        'Ready for discussion',
      ])
      return { pageId, versionId: review.rows[0]!.version_id }
    })
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ id: string }>('SELECT app.add_page_comment($1,$2,$3,$4) AS id', [
        target.pageId,
        target.versionId,
        'looks good',
        '[]',
      ]),
    )
    expect(rows[0]!.id).toBeTypeOf('string')
  })

  it('refuses forging another person as the comment author', async () => {
    // Direct DML is gone now that a command can derive the author and validate
    // page/version ownership. There is no caller-supplied author to forge.
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('INSERT INTO comments (site_id, item_type, item_id, body, author_id) VALUES ($1,$2,$3,$4,$5)', [
          s.siteA,
          'page',
          s.pageA,
          'not me',
          s.editorB,
        ]),
      ),
      '42501',
    )
  })

  it('refuses a cross-site save through the command surface too', async () => {
    const pageB = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteB, 'other', 'Other'])).rows[0]!
          .id,
    )
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [pageB, 0, heroContent(s.heroDefId), '{}']),
      ),
      'CMS02',
    )
  })
})

describe('published pointers are not application data', () => {
  it('direct UPDATE of published_version_id is refused by the column grant', async () => {
    const code = await expectSqlState(
      db.asUser(s.editorA, c => c.query('UPDATE pages SET published_version_id = NULL WHERE id = $1', [s.pageA])),
      '42501',
    )
    expect(code).toBe('42501')
  })

  it('direct UPDATE of the revision CAS token is refused', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('UPDATE pages SET revision = 999 WHERE id = $1', [s.pageA])),
      '42501',
    )
  })

  it('renaming goes through the versioned command, never a direct title update', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('UPDATE pages SET title = $1 WHERE id = $2', ['No checkpoint', s.pageA])),
      '42501',
    )
    const { rowCount } = await db.asUser(s.editorA, async c => {
      const head = (await c.query('SELECT revision,slug FROM pages WHERE id=$1', [s.pageA])).rows[0]!
      return c.query('SELECT * FROM app.rename_page($1,$2,$3,$4)', [
        s.pageA,
        head.revision,
        'Home (renamed)',
        head.slug,
      ])
    })
    expect(rowCount).toBe(1)
  })

  it('writing a published route by hand is refused — projections are command output', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query(
          'INSERT INTO published_routes (site_id, path, page_id, page_version_id, shell_revision, render_manifest) VALUES ($1,$2,$3,$4,$5,$6)',
          [s.siteA, '/forged', s.pageA, s.pageA, 1, '{}'],
        ),
      ),
      '42501',
    )
  })
})

describe('memberships and roles are not application data either', () => {
  it('refuses a self-granted membership on another site', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query("INSERT INTO site_memberships (user_id, site_id, role) VALUES ($1,$2,'site_admin')", [
          s.editorA,
          s.siteB,
        ]),
      ),
      '42501',
    )
  })

  it('refuses a self-granted super admin row', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query("INSERT INTO global_roles (user_id, role) VALUES ($1,'super_admin')", [s.editorA]),
      ),
      '42501',
    )
  })

  it('refuses the membership command to a non-admin of that site', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteB, 'editor'])),
      'CMS02',
    )
  })
})

describe('a disabled user is denied by the database, not only by the app', () => {
  it('resolves to no identity even with a valid session id set', async () => {
    const { rows } = await db.asUser(s.disabled, c =>
      c.query<{ id: string | null }>('SELECT app.current_user_id() AS id'),
    )
    expect(rows[0]!.id).toBeNull()
  })

  it('sees none of the site they were a member of a moment ago', async () => {
    const { rows } = await db.asUser(s.disabled, c => c.query('SELECT id FROM sites'))
    expect(rows).toHaveLength(0)
  })

  it('cannot run a command — an unexpired token buys nothing', async () => {
    await expectSqlState(
      db.asUser(s.disabled, c =>
        c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, 0, heroContent(s.heroDefId), '{}']),
      ),
      'CMS02',
    )
  })

  it('is denied on the next request after deactivation, mid-session', async () => {
    const victim = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', ['temp@example.test', 'Temp']))
          .rows[0]!.id,
    )
    await db.asUser(s.superAdmin, c => c.query('SELECT app.set_site_membership($1,$2,$3)', [victim, s.siteA, 'editor']))

    const before = await db.asUser(victim, c => c.query('SELECT id FROM sites'))
    expect(before.rows).toHaveLength(1)

    await db.asUser(s.superAdmin, c => c.query("SELECT app.set_user_status($1,'disabled')", [victim]))

    const after = await db.asUser(victim, c => c.query('SELECT id FROM sites'))
    expect(after.rows).toHaveLength(0)
  })
})

describe('capability tiers are enforced in the database', () => {
  it('a contributor may save a draft', async () => {
    const { rows } = await db.asUser(s.contributorA, c =>
      c.query('SELECT revision FROM app.save_page_draft($1,(SELECT revision FROM pages WHERE id=$1),$2,$3)', [
        s.pageA,
        heroContent(s.heroDefId, 'Contributor edit'),
        '{}',
      ]),
    )
    expect(Number(rows[0]!.revision)).toBeGreaterThan(0)
  })

  it('a contributor may not publish — they submit for review instead', async () => {
    await expectSqlState(
      db.asUser(s.contributorA, c =>
        c.query('SELECT app.publish_page($1,(SELECT revision FROM pages WHERE id=$1),$2,$3,$4)', [
          s.pageA,
          ...CHECKED_CLEAN,
        ]),
      ),
      'CMS02',
    )
  })

  it('a contributor may not create pages', async () => {
    await expectSqlState(
      db.asUser(s.contributorA, c => c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, 'nope', 'Nope'])),
      'CMS02',
    )
  })

  it('an editor may not create sites', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.create_site($1,$2,$3,$4,$5,$6)', [
          'sneaky',
          'Sneaky',
          'general',
          'sneaky.test',
          '{}',
          '[]',
        ]),
      ),
      'CMS02',
    )
  })
})
