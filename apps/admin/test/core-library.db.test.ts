import { beforeAll, afterAll, expect, it } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { installCoreLibrary } from '@cms/seeds/core-install'
let db: TestDatabase, scenario: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('core_library')
  scenario = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('installs the 59 shared sections, then does nothing on repetition', async () => {
  const before = await db.asUser(scenario.superAdmin, client =>
    client.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id'),
  )
  const first = await db.asUser(scenario.superAdmin, client => installCoreLibrary(client))
  expect(first.created).toBe(59)
  expect(first.updated).toBe(0)
  expect(first.unchanged).toBe(0)
  const versions = await db.asUser(scenario.superAdmin, client =>
    client.query(
      "SELECT v.id FROM section_def_versions v JOIN section_defs d ON d.id=v.section_def_id WHERE d.slug LIKE 'core-%' ORDER BY v.id",
    ),
  )
  const second = await db.asUser(scenario.superAdmin, client => installCoreLibrary(client))
  expect(second.created).toBe(0)
  expect(second.updated).toBe(0)
  expect(second.unchanged).toBe(59)
  const again = await db.asUser(scenario.superAdmin, client =>
    client.query(
      "SELECT v.id FROM section_def_versions v JOIN section_defs d ON d.id=v.section_def_id WHERE d.slug LIKE 'core-%' ORDER BY v.id",
    ),
  )
  expect(again.rows).toEqual(versions.rows)
  const after = await db.asUser(scenario.superAdmin, client =>
    client.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id'),
  )
  expect(after.rows).toEqual(before.rows)
  const definitions = await db.asUser(scenario.superAdmin, client =>
    client.query("SELECT scope,site_id FROM section_defs WHERE slug LIKE 'core-%'"),
  )
  expect(definitions.rows).toHaveLength(59)
  expect(definitions.rows.every(row => row.scope === 'global' && row.site_id === null)).toBe(true)
})
it('denies an ordinary editor without creating or updating a definition', async () => {
  const before = await db.asUser(scenario.superAdmin, client =>
    client.query('SELECT count(*) FROM section_def_versions'),
  )
  await expect(db.asUser(scenario.editorA, client => installCoreLibrary(client))).rejects.toThrow('Only a super admin')
  const after = await db.asUser(scenario.superAdmin, client =>
    client.query('SELECT count(*) FROM section_def_versions'),
  )
  expect(after.rows).toEqual(before.rows)
})
it('accepts supported core style choices and refuses unsupported or custom-code combinations', async () => {
  const installed = await db.asUser(scenario.superAdmin, client => installCoreLibrary(client))
  const text = installed.definitions.get('core-text-block')!,
    hero = installed.definitions.get('core-split-hero')!
  const base = (definition: typeof text) => ({
    section_def_id: definition.id,
    section_def_version: definition.version,
    values: { heading: 'Our story' },
  })
  async function save(content: unknown) {
    return db.asUser(scenario.superAdmin, async client => {
      const page = (
        await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          scenario.siteA,
          `core-style-${crypto.randomUUID()}`,
          'Core style check',
        ])
      ).rows[0]!.id
      return client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3,$4,$5)', [
        page,
        JSON.stringify(content),
        JSON.stringify({ title: 'Core style check' }),
        'checkpoint',
        'Core capability check',
      ])
    })
  }
  await expect(
    save([{ ...base(text), appearance: { spacing: 'compact', width: 'reading', align: 'center', surface: 'soft' } }]),
  ).resolves.toBeDefined()
  await expect(
    save([{ ...base(hero), appearance: { mobileOrder: 'reverse', imagePosition: 'left', surface: 'dark' } }]),
  ).resolves.toBeDefined()
  await expect(save([{ ...base(text), appearance: { mobileOrder: 'reverse' } }])).rejects.toThrow(
    'phone column order requires one two-column group',
  )
  await expect(
    save([{ ...base(hero), appearance: { spacing: 'compact' }, custom_css: '.anything{color:red}' }]),
  ).rejects.toThrow('reset appearance')
})

it('keeps the new dark surface and picture position closed, capability-checked and idempotently migrated', async () => {
  const installed = await db.asUser(scenario.superAdmin, client => installCoreLibrary(client))
  const text = installed.definitions.get('core-text-block')!
  await expect(
    db.asUser(scenario.editorA, async client => {
      const page = (
        await client.query('SELECT app.create_page($1,$2,$3) AS id', [
          scenario.siteA,
          'unsupported-picture',
          'Picture check',
        ])
      ).rows[0]!.id
      return client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([
          {
            section_def_id: text.id,
            section_def_version: text.version,
            values: { heading: 'Text' },
            appearance: { imagePosition: 'left' },
          },
        ]),
        '{}',
      ])
    }),
  ).rejects.toThrow('this section does not support that style choice')
  const source = await import('node:fs/promises').then(fs =>
    fs.readFile(new URL('../../../packages/schema/migrations/0122_r8_style_choices.sql', import.meta.url), 'utf8'),
  )
  await db.as('owner', client => client.query(source))
  await db.as('owner', client => client.query(source))
  await expect(
    db.as('owner', client =>
      client.query('SELECT app.assert_section_appearance_contrast($1,$2)', [
        JSON.stringify({ sections: [{ instance: { appearance: { surface: 'dark' } } }] }),
        JSON.stringify({ colors: { ink: '#ffffff', surface: '#ffffff' } }),
      ]),
    ),
  ).rejects.toThrow('4.5:1')
})
