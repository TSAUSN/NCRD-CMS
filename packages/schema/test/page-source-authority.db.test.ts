import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'

let db: TestDatabase, s: Scenario, siteAdmin: string
type Section = Record<string, unknown>
type Saved = { version_id: string; revision: string; carries_trusted_code: boolean }
const HTML = '<p>Approved custom layout</p>'
const CSS = '.hero{color:#123456}'
beforeAll(async () => {
  db = await TestDatabase.create('page_source_roles')
  s = await seedScenario(db)
  siteAdmin = await db.asUser(s.superAdmin, async client => {
    const user = (await client.query("SELECT app.provision_user('page-source-admin@example.test','Site admin') AS id"))
      .rows[0]!.id
    await client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [user, s.siteA])
    // A real second definition version ensures a refused pin change is an
    // authority boundary, rather than a missing-definition validation error.
    await client.query(
      `SELECT app.upsert_section_def_version(
      'hero','Hero','Openers',v.source_html,v.source_css,v.compiled_css,v.compiled_ast,v.slots,
      'page-source-role-pin-v2',v.sanitizer_policy_version,v.css_policy_version,'Second layout version')
      FROM section_def_versions v WHERE v.section_def_id=$1 AND v.version=1`,
      [s.heroDefId],
    )
    return user
  })
})
afterAll(async () => {
  await db?.close()
})
function section(extra: Section = {}): Section {
  return { ...JSON.parse(heroContent(s.heroDefId))[0], ...extra }
}
function source(extra: Section = {}): Section {
  return section({ raw_html: HTML, custom_css: CSS, ...extra })
}
async function page(actor = s.editorA): Promise<string> {
  return db.asUser(
    actor,
    async client =>
      (
        await client.query('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          `source-${randomUUID().slice(0, 8)}`,
          'Source boundary',
        ])
      ).rows[0]!.id,
  )
}
async function save(id: string, revision: number | string, sections: Section[], actor = s.editorA): Promise<Saved> {
  return db.asUser(
    actor,
    async client =>
      (
        await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          id,
          revision,
          JSON.stringify(sections),
          '{}',
        ])
      ).rows[0]!,
  )
}
async function state(id: string) {
  return db.asUser(
    s.superAdmin,
    async client =>
      (
        await client.query(
          `SELECT revision,draft_version_id,
    (SELECT count(*) FROM page_versions WHERE page_id=p.id) AS versions,
    (SELECT count(*) FROM audit_log WHERE item_id=p.id) AS events FROM pages p WHERE p.id=$1`,
          [id],
        )
      ).rows[0],
  )
}

describe('page custom source authority', () => {
  it.each(['site_admin', 'editor', 'contributor'] as const)(
    'refuses new raw HTML and CSS from a %s, through direct commands',
    async role => {
      const actor = role === 'site_admin' ? siteAdmin : role === 'editor' ? s.editorA : s.contributorA
      const id = await page(),
        before = await state(id)
      for (const authored of [section({ raw_html: HTML }), section({ custom_css: CSS }), source()]) {
        await expectSqlState(save(id, 0, [authored], actor), 'CMS02')
        expect(await state(id)).toEqual(before)
      }
    },
  )

  it('allows super-admin source authorship while requiring separate publication approval', async () => {
    const id = await page(),
      saved = await save(id, 0, [source()], s.superAdmin)
    expect(saved.carries_trusted_code).toBe(true)
    expect(
      (
        await db.asUser(s.editorA, client =>
          client.query('SELECT trusted_code_approved_by FROM page_versions WHERE id=$1', [saved.version_id]),
        )
      ).rows[0]!.trusted_code_approved_by,
    ).toBeNull()
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT app.publish_page($1,$2,1,NULL,$3)', [id, saved.revision, '[]']),
      ),
      'CMS05',
    )
  })

  it.each(['site_admin', 'editor', 'contributor'] as const)(
    'lets a %s edit content, reorder and duplicate a retained tuple',
    async role => {
      const actor = role === 'site_admin' ? siteAdmin : role === 'editor' ? s.editorA : s.contributorA
      const id = await page(),
        initial = await save(id, 0, [source(), section()], s.superAdmin)
      await db.asUser(s.superAdmin, client => client.query('SELECT app.approve_trusted_code($1)', [initial.version_id]))
      const ordinary = section({ values: { heading: 'New ordinary heading', intro: 'Preserved code' } })
      const retained = source({
        values: { heading: 'Edited supported field', intro: 'Still editable' },
        label: 'Renamed section',
      })
      const saved = await save(id, initial.revision, [ordinary, retained, retained], actor)
      expect(saved.carries_trusted_code).toBe(true)
      const rows = (
        await db.asUser(actor, client =>
          client.query('SELECT content,trusted_code_approved_by FROM page_versions WHERE id=$1', [saved.version_id]),
        )
      ).rows
      expect(rows[0]!.content).toEqual([ordinary, retained, retained])
      expect(rows[0]!.trusted_code_approved_by).toBeNull()
    },
  )

  it.each(['html', 'css', 'pin', 'mixed_tuple'] as const)(
    'refuses a new %s combination even when the page retains custom code',
    async change => {
      const id = await page(),
        first = await save(id, 0, [source()], s.superAdmin)
      const second = await save(
        id,
        first.revision,
        [source({ raw_html: '<p>Other approved layout</p>', custom_css: '.hero{padding:2rem}' })],
        s.superAdmin,
      )
      const next = source()
      if (change === 'html') next.raw_html = '<p>Changed by ordinary editor</p>'
      if (change === 'css') next.custom_css = '.hero{color:red}'
      if (change === 'pin') next.section_def_version = 2
      if (change === 'mixed_tuple') next.custom_css = '.hero{padding:2rem}'
      const before = await state(id)
      await expectSqlState(save(id, second.revision, [next]), 'CMS02')
      expect(await state(id)).toEqual(before)
    },
  )

  it('does not treat another page history as authority to introduce source', async () => {
    const original = await page()
    await save(original, 0, [source()], s.superAdmin)
    const other = await page()
    await expectSqlState(save(other, 0, [source()]), 'CMS02')
    await expectSqlState(save(other, 0, [source()], siteAdmin), 'CMS02')
  })

  it('permits removing code and restores an exact own-page historical tuple without carrying approval', async () => {
    const id = await page(),
      initial = await save(id, 0, [source()], s.superAdmin)
    await db.asUser(s.superAdmin, client => client.query('SELECT app.approve_trusted_code($1)', [initial.version_id]))
    const cleared = await save(id, initial.revision, [section()])
    expect(cleared.carries_trusted_code).toBe(false)
    const carried = await save(id, cleared.revision, [source()])
    const restored = await db.asUser(
      s.contributorA,
      async client =>
        (
          await client.query('SELECT * FROM app.restore_version_as_draft($1,$2,$3)', [
            id,
            carried.revision,
            initial.version_id,
          ])
        ).rows[0]!,
    )
    const row = (
      await db.asUser(s.editorA, client =>
        client.query('SELECT content,kind,trusted_code_approved_by FROM page_versions WHERE id=$1', [
          restored.version_id,
        ]),
      )
    ).rows[0]!
    expect(row).toMatchObject({ content: [source()], kind: 'restore', trusted_code_approved_by: null })
  })

  it('cannot bypass the boundary with direct row writes or an exposed trigger helper', async () => {
    const id = await page()
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query(
          `INSERT INTO page_versions(site_id,page_id,revision,content,meta,carries_trusted_code,kind,note,author_id)
      VALUES($1,$2,1,$3,'{}',false,'autosave','',$4)`,
          [s.siteA, id, JSON.stringify([source()]), s.editorA],
        ),
      ),
      '42501',
    )
    for (const role of ['authenticated', 'public', 'worker'] as const) {
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.require_page_source_authority()')),
        '42501',
      )
    }
  })
})
