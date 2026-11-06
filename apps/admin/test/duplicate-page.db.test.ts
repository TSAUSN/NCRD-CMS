import { beforeAll, afterAll, expect, it } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
let db: TestDatabase, s: Scenario, source: string, parent: string
beforeAll(async () => {
  db = await TestDatabase.create('duplicate_page')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async client => {
    parent = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'parent', 'Parent'])).rows[0]!.id
    source = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'source', 'Source page'])).rows[0]!
      .id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      source,
      JSON.stringify([
        {
          section_def_id: s.heroDefId,
          section_def_version: 1,
          values: {
            heading: 'A sample',
            intro: 'Keep this exact body',
            __cms_sample_fields: ['heading'],
            __cms_anchor: 'overview',
          },
        },
      ]),
      '{"canonical":"/source","description":"Keep the description"}',
    ])
    await client.query('SELECT app.set_page_parent($1,1,$2)', [source, parent])
  })
})
afterAll(async () => {
  await db?.close()
})
async function head() {
  return (
    await db.asUser(s.editorA, client =>
      client.query(
        'SELECT id,revision,draft_version_id,published_version_id,title,slug,parent_page_id FROM pages WHERE id=$1',
        [source],
      ),
    )
  ).rows[0]!
}
it('creates private copies with unique addresses, exact content/pins/samples, preserved grouping and no old canonical', async () => {
  const before = await head(),
    copies = []
  for (let i = 0; i < 2; i++)
    copies.push(
      (
        await db.asUser(s.editorA, client =>
          client.query('SELECT * FROM app.duplicate_page($1,$2)', [source, before.revision]),
        )
      ).rows[0]!,
    )
  expect(copies[0]!.page_id).not.toBe(copies[1]!.page_id)
  for (const [index, copy] of copies.entries()) {
    const row = (
      await db.asUser(s.editorA, client =>
        client.query(
          'SELECT p.slug,p.title,p.parent_page_id,p.published_version_id,v.content,v.meta,v.trusted_code_approved_by FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [copy.page_id],
        ),
      )
    ).rows[0]!
    expect(row.slug).toBe(index ? 'source-copy-2' : 'source-copy')
    expect(row.title).toBe('Copy of Source page')
    expect(row.parent_page_id).toBe(parent)
    expect(row.published_version_id).toBeNull()
    expect(row.content[0]).toMatchObject({
      section_def_id: s.heroDefId,
      section_def_version: 1,
      values: {
        heading: 'A sample',
        intro: 'Keep this exact body',
        __cms_sample_fields: ['heading'],
        __cms_anchor: 'overview',
      },
    })
    expect(row.meta).not.toHaveProperty('canonical')
    expect(row.meta.description).toBe('Keep the description')
    expect(row.trusted_code_approved_by).toBeNull()
  }
  expect(await head()).toEqual(before)
})
it('refuses stale sources and people without page-management rights', async () => {
  const before = await head()
  await expect(
    db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.duplicate_page($1,$2)', [source, Number(before.revision) - 1]),
    ),
  ).rejects.toMatchObject({ code: 'CMS01' })
  for (const actor of [s.contributorA, s.editorB, s.disabled])
    await expect(
      db.asUser(actor, client => client.query('SELECT * FROM app.duplicate_page($1,$2)', [source, before.revision])),
    ).rejects.toThrow()
  expect(await head()).toEqual(before)
})
