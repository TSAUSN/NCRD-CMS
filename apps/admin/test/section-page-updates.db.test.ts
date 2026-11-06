import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { compileSection } from '@cms/renderer'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import type { Queryable } from '@cms/platform'
vi.mock('server-only', () => ({}))
import {
  applySectionPageUpdates,
  listSectionUpdatePages,
  previewSectionPageUpdate,
  type SectionPagePin,
} from '../src/lib/section-page-updates.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('section_page_updates')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async client => {
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'site_admin'])
    const row = (
      await client.query('SELECT * FROM section_def_versions WHERE section_def_id=$1 AND version=1', [s.heroDefId])
    ).rows[0]!
    const html = row.source_html + '<p>Updated layout</p><p>{{extra}}</p>',
      slots = [
        ...row.slots,
        {
          id: 'extra',
          kind: 'text',
          label: 'Extra words',
          constraints: { sourceSample: 'Do not invent this content' },
        },
      ],
      compiled = compileSection({
        sourceHtml: html,
        sourceCss: row.source_css,
        slots,
        scopeSelector: '.cms-section--hero',
      })
    expect(compiled.blocking).toEqual([])
    await client.query(
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        'hero',
        'Hero',
        'Openers',
        html,
        row.source_css,
        compiled.css,
        JSON.stringify(compiled.ast),
        JSON.stringify(slots),
        compiled.renderHash,
        row.sanitizer_policy_version,
        row.css_policy_version,
        'Update layout',
        false,
        'legacy',
        null,
        null,
      ],
    )
  })
})
afterAll(async () => {
  await db?.close()
})
async function batch() {
  return db.asUser(s.superAdmin, async client => {
    const pins: SectionPagePin[] = []
    for (const siteId of [s.siteA, s.siteA, s.siteB]) {
      const pageId = (
        await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, randomUUID(), 'Page for update'])
      ).rows[0]!.id
      const content = [
        ...JSON.parse(heroContent(s.heroDefId, 'First original')),
        ...JSON.parse(heroContent(s.heroDefId, 'Second original')),
      ]
      await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
        pageId,
        JSON.stringify(content),
        JSON.stringify({ description: 'A complete test page for version updates.' }),
      ])
      await client.query('SELECT * FROM app.publish_page($1,1,$2,$3,$4)', [pageId, ...CHECKED_CLEAN])
      const row = (
        await client.query(
          'SELECT draft_version_id AS "sourceVersionId",revision::int AS revision FROM pages WHERE id=$1',
          [pageId],
        )
      ).rows[0]!
      pins.push({ pageId, ...row })
    }
    return pins
  })
}
async function heads(client: Queryable, pins: SectionPagePin[]) {
  return (
    await client.query(
      `SELECT p.id,p.revision,p.draft_version_id,p.published_version_id,v.content,v.meta,(SELECT count(*)::int FROM page_versions h WHERE h.page_id=p.id) AS versions FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=ANY($1::uuid[]) ORDER BY p.id`,
      [pins.map(pin => pin.pageId)],
    )
  ).rows
}
it('lists only older current drafts on administered sites, with honest placement counts', async () => {
  const pins = await batch(),
    rows = await db.asUser(s.editorA, client => listSectionUpdatePages(client, s.siteA, s.heroDefId, 2))
  expect(rows.filter(row => pins.some(pin => pin.pageId === row.pageId))).toHaveLength(2)
  expect(rows.some(row => row.pageId === pins[2]!.pageId)).toBe(false)
  expect(rows.find(row => row.pageId === pins[0]!.pageId)?.placements).toBe(2)
  const all = await db.asUser(s.superAdmin, client => listSectionUpdatePages(client, s.siteA, s.heroDefId, 2))
  expect(all.filter(row => pins.some(pin => pin.pageId === row.pageId))).toHaveLength(3)
})
it('compares all placements together without inventing new field content or writing a draft', async () => {
  const pins = await batch(),
    before = await db.asUser(s.superAdmin, client => heads(client, pins))
  const preview = await db.asUser(s.editorA, client =>
    previewSectionPageUpdate(client, s.siteA, s.heroDefId, 2, pins[0]!),
  )
  expect(preview.plans).toHaveLength(2)
  expect(preview.plans[0]!.added).toEqual(['Extra words'])
  expect(preview.html.match(/Updated layout/g)).toHaveLength(2)
  expect(preview.beforeHtml).not.toContain('Updated layout')
  for (const html of [preview.beforeHtml, preview.html]) {
    expect(html).toContain('First original')
    expect(html).toContain('Second original')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('Do not invent this content')
  }
  expect(await db.asUser(s.superAdmin, client => heads(client, pins))).toEqual(before)
})
it('updates selected drafts atomically, preserves live/history/meta and rejects replay', async () => {
  const pins = await batch(),
    before = await db.asUser(s.superAdmin, client => heads(client, pins)),
    pin = pins[0]!
  expect(await db.asUser(s.editorA, client => applySectionPageUpdates(client, s.siteA, s.heroDefId, 2, [pin]))).toBe(1)
  const after = await db.asUser(s.superAdmin, client => heads(client, pins)),
    changed = after.find(row => row.id === pin.pageId)!,
    original = before.find(row => row.id === pin.pageId)!
  expect(changed.published_version_id).toBe(original.published_version_id)
  expect(changed.meta).toEqual(original.meta)
  expect(changed.versions).toBe(original.versions + 2)
  expect(changed.content.map((item: { section_def_version: number }) => item.section_def_version)).toEqual([2, 2])
  expect(changed.content[0].values.heading).toBe('First original')
  expect(changed.content[0].values).not.toHaveProperty('extra')
  for (const other of pins.slice(1))
    expect(after.find(row => row.id === other.pageId)).toEqual(before.find(row => row.id === other.pageId))
  await expect(
    db.asUser(s.editorA, client => applySectionPageUpdates(client, s.siteA, s.heroDefId, 2, [pin])),
  ).rejects.toThrow(/changed after/)
  expect(await db.asUser(s.superAdmin, client => heads(client, pins))).toEqual(after)
})
it('rolls back earlier page saves when a later sorted page has changed', async () => {
  const pins = (await batch()).slice(0, 2).sort((a, b) => a.pageId.localeCompare(b.pageId)),
    stale = pins[1]!
  await db.asUser(s.editorA, async client => {
    const row = (
      await client.query(
        'SELECT v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [stale.pageId],
      )
    ).rows[0]!
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      stale.pageId,
      stale.revision,
      JSON.stringify(row.content),
      JSON.stringify({ ...row.meta, description: 'Changed after review' }),
    ])
  })
  const before = await db.asUser(s.superAdmin, client => heads(client, pins))
  await expect(
    db.asUser(s.editorA, client => applySectionPageUpdates(client, s.siteA, s.heroDefId, 2, pins)),
  ).rejects.toThrow(/changed after/)
  expect(await db.asUser(s.superAdmin, client => heads(client, pins))).toEqual(before)
})
it('refuses Contributors, Editors, foreign pages and malformed selections without writes', async () => {
  const pins = await batch(),
    before = await db.asUser(s.superAdmin, client => heads(client, pins))
  for (const actor of [s.contributorA, s.editorB])
    await expect(db.asUser(actor, client => listSectionUpdatePages(client, s.siteA, s.heroDefId, 2))).rejects.toThrow(
      /administrator/,
    )
  await expect(
    db.asUser(s.editorA, client => applySectionPageUpdates(client, s.siteA, s.heroDefId, 2, [pins[2]!])),
  ).rejects.toThrow(/no longer available/)
  for (const chosen of [
    [],
    [pins[0]!, pins[0]!],
    Array.from({ length: 101 }, (_, index) => ({
      ...pins[0]!,
      pageId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    })),
  ])
    await expect(
      db.asUser(s.superAdmin, client => applySectionPageUpdates(client, s.siteA, s.heroDefId, 2, chosen)),
    ).rejects.toThrow(/1 and 100/)
  expect(await db.asUser(s.superAdmin, client => heads(client, pins))).toEqual(before)
})
it('refuses a stale comparison and a page whose administration permission was removed', async () => {
  const pins = await batch(),
    pin = pins[0]!
  await expect(
    db.asUser(s.editorA, client =>
      previewSectionPageUpdate(client, s.siteA, s.heroDefId, 2, { ...pin, revision: pin.revision - 1 }),
    ),
  ).rejects.toThrow(/changed after/)
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'editor']),
  )
  try {
    await expect(
      db.asUser(s.editorA, client => applySectionPageUpdates(client, s.siteA, s.heroDefId, 2, [pin])),
    ).rejects.toThrow(/administrator/)
  } finally {
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'site_admin']),
    )
  }
})
