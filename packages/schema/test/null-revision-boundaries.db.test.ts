import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
import { expectSqlState, TestDatabase } from './harness.ts'
import { ThemeTokens } from '../src/content/index.ts'

let db: TestDatabase
let s: Scenario
let sequence = 0
const fields = [{ key: 'title', label: 'Title', type: 'text', required: true }]
const presentation = { schemaVersion: 1, titleField: 'title', subtitleField: null, imageField: null, groupField: null }
beforeAll(async () => {
  db = await TestDatabase.create('null_revision')
  s = await seedScenario(db)
  // The generic fixture preserves a historical compact theme; use today's
  // complete validated shape so no unrelated shape error masks a CAS bypass.
  await db.asUser(s.superAdmin, async client => {
    const theme = (
      await client.query(
        'SELECT t.revision,v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
        [s.siteA],
      )
    ).rows[0]!
    const saved = (
      await client.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [
        s.siteA,
        theme.revision,
        JSON.stringify(ThemeTokens.parse(theme.tokens)),
      ])
    ).rows[0]!
    await client.query('SELECT * FROM app.publish_theme($1,$2)', [s.siteA, saved.revision])
  })
})
afterAll(async () => {
  await db?.close()
})

async function page() {
  return db.asUser(s.editorA, async client => {
    const id = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, `cas-${++sequence}`, 'CAS fixture'])
    ).rows[0]!.id
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, heroContent(s.heroDefId), '{}'])
    ).rows[0]!
    return { id, version: saved.version_id, revision: saved.revision }
  })
}
async function collection() {
  return db.asUser(s.superAdmin, async client => {
    const n = ++sequence
    return (
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        `cas-${n}`,
        'CAS collection',
        `cas_${n}`,
        JSON.stringify(fields),
        JSON.stringify(presentation),
      ])
    ).rows[0]!
  })
}
async function media() {
  return db.as(
    'owner',
    async client =>
      (
        await client.query(
          `INSERT INTO media
    (site_id,object_key,content_hash,original_name,alt_text,decorative,width,height,bytes,mime_type,status,uploaded_by)
    VALUES($1,$2,$3,'cas.jpg','CAS fixture',false,20,20,120,'image/jpeg','ready',$4) RETURNING id`,
          [s.siteA, `cas/${randomUUID()}.jpg`, randomUUID().replaceAll('-', '').padEnd(64, 'a'), s.superAdmin],
        )
      ).rows[0]!.id,
  )
}
async function globalHeads() {
  return db.asUser(
    s.superAdmin,
    async client =>
      (
        await client.query(
          `SELECT g.kind,g.revision,v.content
    FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind`,
          [s.siteA],
        )
      ).rows,
  )
}
/** A rejected command must not advance heads, append versions/audit, or enqueue public work. */
async function snapshot() {
  return db.as(
    'owner',
    async client =>
      (
        await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM pages p) AS pages,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM navigations n) AS navigation,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM themes t) AS themes,
    (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM global_elements g) AS frames,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM collections c) AS collections,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM collection_entries e) AS entries,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM media m) AS media,
    (SELECT count(*) FROM page_versions) AS page_versions,
    (SELECT count(*) FROM theme_versions) AS theme_versions,
    (SELECT count(*) FROM navigation_versions) AS navigation_versions,
    (SELECT count(*) FROM global_element_versions) AS frame_versions,
    (SELECT count(*) FROM collection_schema_versions) AS schema_versions,
    (SELECT count(*) FROM collection_entry_versions) AS entry_versions,
    (SELECT count(*) FROM submissions) AS submissions,
    (SELECT count(*) FROM audit_log) AS audit,
    (SELECT count(*) FROM outbox) AS outbox`)
      ).rows[0],
  )
}
async function refuses(sql: string, params: unknown[], actor = s.superAdmin) {
  const before = await snapshot()
  await expectSqlState(
    db.asUser(actor, client => client.query(sql, params)),
    'CMS01',
  )
  expect(await snapshot()).toEqual(before)
}

describe('required compare-and-set revisions cannot be omitted', () => {
  it('refuses a NULL page save revision without displacing a newer draft', async () => {
    const p = await page()
    await refuses(
      'SELECT * FROM app.save_page_draft($1,$2,$3,$4)',
      [p.id, null, heroContent(s.heroDefId, 'Must not overwrite'), '{}'],
      s.contributorA,
    )
  })
  it('refuses a NULL review submission revision', async () => {
    const p = await page()
    await refuses(
      'SELECT * FROM app.submit_page_for_review($1,$2,$3)',
      [p.id, null, 'Must not submit unknown head'],
      s.contributorA,
    )
  })
  it('keeps historical restoration protected by its existing exact revision check', async () => {
    const p = await page()
    await refuses('SELECT * FROM app.restore_version_as_draft($1,$2,$3)', [p.id, null, p.version], s.contributorA)
  })
  it('refuses a NULL navigation save revision', async () => {
    await refuses('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [s.siteA, null, '[]', 'manual'], s.editorA)
  })
  for (const command of ['save_theme_draft', 'publish_theme', 'revert_theme_to_live']) {
    it(`refuses a NULL ${command} revision`, async () => {
      const args: unknown[] = [s.siteA, null]
      if (command === 'save_theme_draft')
        args.push(
          JSON.stringify(
            (
              await db.asUser(s.superAdmin, client =>
                client.query(
                  'SELECT v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
                  [s.siteA],
                ),
              )
            ).rows[0]!.tokens,
          ),
        )
      await refuses(`SELECT * FROM app.${command}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args)
    })
  }
  for (const command of ['save_global_elements_draft', 'publish_global_elements', 'revert_global_elements_to_live']) {
    for (const missing of ['header', 'footer']) {
      it(`refuses a NULL ${missing} revision for ${command}`, async () => {
        const heads = await globalHeads()
        const header = heads.find(h => h.kind === 'header')!,
          footer = heads.find(h => h.kind === 'footer')!
        const args: unknown[] = [
          s.siteA,
          missing === 'header' ? null : header.revision,
          missing === 'footer' ? null : footer.revision,
        ]
        if (command === 'save_global_elements_draft')
          args.push(JSON.stringify(header.content), JSON.stringify(footer.content))
        await refuses(`SELECT * FROM app.${command}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args, s.editorA)
      })
    }
  }
  for (const command of [
    'save_collection_schema',
    'publish_collection_schema',
    'save_collection_entries',
    'publish_collection_entries',
  ]) {
    it(`refuses a NULL ${command} revision through the public command`, async () => {
      const c = await collection()
      if (command === 'publish_collection_entries') {
        await db.asUser(s.superAdmin, client =>
          client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [c.collection_id, c.revision]),
        )
      }
      const args: unknown[] = [c.collection_id, null]
      if (command === 'save_collection_schema') args.push(JSON.stringify(fields), JSON.stringify(presentation))
      if (command === 'save_collection_entries') args.push('[]')
      await refuses(`SELECT * FROM app.${command}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args)
    })
  }
  it('refuses a NULL media metadata revision', async () => {
    await refuses(
      'SELECT app.update_media_metadata($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [await media(), null, 'Changed', false, null, '', '', '', []],
      s.editorA,
    )
  })
  it('refuses a NULL media deletion revision', async () => {
    await refuses('SELECT app.soft_delete_media($1,$2,$3,$4)', [await media(), null, false, null])
  })
  it('refuses a NULL media restoration revision', async () => {
    const id = await media()
    await db.asUser(s.superAdmin, client => client.query('SELECT app.soft_delete_media($1,1,false,NULL)', [id]))
    await refuses('SELECT app.restore_media($1,$2)', [id, null])
  })
  it('rolls back bulk organization when a later item has a NULL revision', async () => {
    await refuses(
      'SELECT * FROM app.bulk_organize_media($1,$2,$3,$4,$5)',
      [[await media(), await media()], [1, null], 'Must Not Move', [], []],
      s.editorA,
    )
  })
  it('rolls back bulk deletion when a later item has a NULL revision', async () => {
    await refuses('SELECT * FROM app.bulk_soft_delete_media($1,$2,$3,$4)', [
      [await media(), await media()],
      [1, null],
      false,
      null,
    ])
  })
  it('still allows the loaded revision and refuses the previous one', async () => {
    const p = await page()
    const saved = await db.asUser(s.contributorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        p.id,
        p.revision,
        heroContent(s.heroDefId, 'A known head'),
        '{}',
      ]),
    )
    expect(saved.rows[0]!.revision).toBe(String(Number(p.revision) + 1))
    await refuses(
      'SELECT * FROM app.save_page_draft($1,$2,$3,$4)',
      [p.id, p.revision, heroContent(s.heroDefId), '{}'],
      s.contributorA,
    )
  })
  it('retains tenant authorization before revision diagnostics', async () => {
    const p = await page()
    await expectSqlState(
      db.asUser(s.editorB, client =>
        client.query('SELECT * FROM app.save_page_draft($1,NULL,$2,$3)', [p.id, heroContent(s.heroDefId), '{}']),
      ),
      'CMS02',
    )
  })
})
