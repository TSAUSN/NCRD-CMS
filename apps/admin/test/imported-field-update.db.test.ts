import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compileSection } from '@cms/renderer'
import { editableReference } from '@cms/importer/editable-reference'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'

let db: TestDatabase
let s: Scenario
let actor: string
let definition: string
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/lib/session.ts', () => ({
  currentSession: async () => ({ principal: { userId: actor, isSuperAdmin: actor === s.superAdmin } }),
}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import {
  applyImportedFieldUpdate,
  previewImportedFieldUpdate,
} from '../src/app/pages/[pageId]/imported-update-actions.ts'

// How an earlier importer left a styled overview: one text field per paragraph.
const PRESENTED = 'class="lead" style="font-family: var(--font-secondary);"'
const A = `v1-${'a'.repeat(24)}`,
  B = `v1-${'b'.repeat(24)}`
const slug = 'v1-work-overview-fixture'
let NOTE = ''

async function head() {
  return (
    await db.asUser(s.superAdmin, client =>
      client.query(
        `SELECT p.revision,p.draft_version_id,p.published_version_id,v.content,v.kind,v.note
    FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1`,
        [s.pageA],
      ),
    )
  ).rows[0]!
}
const request = (sourceVersionId: string) => ({ pageId: s.pageA, sourceVersionId, index: 0 })

/** An imported-style layout in site A, as the earlier importer left it. */
async function oldDefinition(name: string): Promise<string> {
  const sourceHtml = `<div class="space-y-4" data-block-id="overview-body" data-editable="richtext"><p ${PRESENTED}>{{${A}}}</p>\n<p ${PRESENTED}>{{${B}}}</p></div><p data-block-id="note" data-editable="text">{{${NOTE}}}</p>`
  const slots = [
    { id: A, kind: 'text' as const, label: 'Overview body · part 1', constraints: {} },
    { id: B, kind: 'text' as const, label: 'Overview body · part 2', constraints: {} },
    { id: NOTE, kind: 'text' as const, label: 'Note', constraints: {} },
  ]
  const compiled = compileSection({
    sourceHtml,
    sourceCss: '.lead{color:#123}',
    slots,
    scopeSelector: `.cms-section--${name}`,
  })
  return db.asUser(
    s.superAdmin,
    async client =>
      (
        await client.query(
          'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
          [
            name,
            'Home — Overview',
            'Migrated V1 content',
            sourceHtml,
            '.lead{color:#123}',
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            'Imported fixture',
            compiled.carriesTrustedCode,
            'legacy',
            null,
            null,
            'site',
            s.siteA,
            0,
            null,
          ],
        )
      ).rows[0]!.section_def_id,
  )
}
const overview = (definitionId: string) => [
  {
    section_def_id: definitionId,
    section_def_version: 1,
    label: 'Overview',
    hidden: false,
    hidden_at: [],
    values: { [A]: 'First paragraph.', [B]: 'Second paragraph, edited in V2.', [NOTE]: 'Kept exactly' },
  },
]
async function pageWith(definitionId: string): Promise<{ id: string; versionId: string }> {
  return db.asUser(s.editorA, async client => {
    const id = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        s.siteA,
        `imported-${Math.random().toString(36).slice(2, 10)}`,
        'Imported page',
      ])
    ).rows[0]!.id as string
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify(overview(definitionId)),
        '{}',
      ])
    ).rows[0]!
    return { id, versionId: saved.version_id as string }
  })
}

beforeAll(async () => {
  db = await TestDatabase.create('imported_field_update')
  s = await seedScenario(db)
  actor = s.superAdmin
  NOTE = editableReference({
    slug,
    css: '',
    html: `<div class="space-y-4" data-block-id="overview-body" data-editable="richtext"><p ${PRESENTED}>x</p>\n<p ${PRESENTED}>y</p></div><p data-block-id="note" data-editable="text">z</p>`,
  }).slots.find(slot => slot.label === 'Note')!.id
  definition = await oldDefinition(slug)
  await db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      s.pageA,
      JSON.stringify(overview(definition)),
      JSON.stringify({ title: 'Home' }),
    ]),
  )
  await db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN]),
  )
})
afterAll(async () => {
  await db?.close()
})

describe('updating an imported section to the current field mapping against real database roles', () => {
  it('previews the joined field without saving anything, and only for a super admin', async () => {
    const before = await head()
    const preview = await previewImportedFieldUpdate(request(before.draft_version_id))
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.removed.map(field => field.label)).toEqual(['Overview body · part 1', 'Overview body · part 2'])
    expect(preview.added.map(field => [field.label, field.kind])).toEqual([['Overview body', 'richtext']])
    expect(preview.otherPages).toBe(0)
    expect(preview.html).toContain(`<p ${PRESENTED}>Second paragraph, edited in V2.</p>`)
    expect(await head()).toEqual(before)
    actor = s.editorA
    try {
      expect(await previewImportedFieldUpdate(request(before.draft_version_id))).toMatchObject({ ok: false })
    } finally {
      actor = s.superAdmin
    }
  })

  it('saves a new layout version and a checkpoint, moves only this section, and leaves the live page alone', async () => {
    const before = await head()
    const result = await applyImportedFieldUpdate(request(before.draft_version_id), Number(before.revision))
    if (!result.ok) throw new Error(result.message)
    const after = await head()
    expect(after.draft_version_id).toBe(result.versionId)
    expect(after.published_version_id).toBe(before.published_version_id)
    const section = after.content[0]
    expect(section.section_def_version).toBe(2)
    const body = Object.entries(section.values as Record<string, unknown>).find(([id]) => ![NOTE].includes(id))!
    expect(body[1]).toBe('<p>First paragraph.</p>\n<p>Second paragraph, edited in V2.</p>')
    expect(section.values[NOTE]).toBe('Kept exactly')
    expect(result.definition).toMatchObject({ section_def_id: definition, version: 2 })
    const versions = (
      await db.asUser(s.superAdmin, client =>
        client.query(
          'SELECT version,slots,changelog FROM section_def_versions WHERE section_def_id=$1 ORDER BY version',
          [definition],
        ),
      )
    ).rows
    expect(versions.map(version => version.slots.map((slot: { kind: string }) => slot.kind))).toEqual([
      ['text', 'text', 'text'],
      ['richtext', 'text'],
    ])
    expect(versions[1]!.changelog).toContain('Overview body · part 1, Overview body · part 2 → Overview body')
    const kept = (
      await db.asUser(s.superAdmin, client =>
        client.query(
          "SELECT content FROM page_versions WHERE page_id=$1 AND note LIKE 'Before updating the imported fields%'",
          [s.pageA],
        ),
      )
    ).rows
    expect(kept).toHaveLength(1)
    expect(kept[0]!.content[0].section_def_version).toBe(1)
    // The live page still renders the old version, untouched.
    const live = (
      await db.asUser(s.superAdmin, client =>
        client.query('SELECT content FROM page_versions WHERE id=$1', [before.published_version_id]),
      )
    ).rows[0]!
    expect(live.content[0].section_def_version).toBe(1)
    // Done once: the fields are now current.
    expect(await previewImportedFieldUpdate(request(after.draft_version_id))).toMatchObject({
      ok: false,
      message: expect.stringContaining('already match'),
    })
  })

  it('refuses a stale review, an ordinary editor, and a layout shared with another page', async () => {
    const own = await oldDefinition('v1-work-own-fixture')
    const single = await pageWith(own)
    const one = { pageId: single.id, sourceVersionId: single.versionId, index: 0 }
    expect(await applyImportedFieldUpdate(one, 0)).toMatchObject({ ok: false, kind: 'conflict' })
    actor = s.editorA
    try {
      expect(await applyImportedFieldUpdate(one, 1)).toMatchObject({ ok: false })
    } finally {
      actor = s.superAdmin
    }
    const shared = await oldDefinition('v1-work-shared-fixture')
    const first = await pageWith(shared),
      second = await pageWith(shared)
    const preview = await previewImportedFieldUpdate({ pageId: first.id, sourceVersionId: first.versionId, index: 0 })
    expect(preview).toMatchObject({ ok: true, otherPages: 1 })
    expect(
      await applyImportedFieldUpdate({ pageId: first.id, sourceVersionId: first.versionId, index: 0 }, 1),
    ).toMatchObject({ ok: false, message: expect.stringContaining('also used on 1 other page') })
    // Nothing moved: both pages and the layout stay as they were.
    const versions = (
      await db.asUser(s.superAdmin, client =>
        client.query('SELECT count(*)::int AS count FROM section_def_versions WHERE section_def_id=ANY($1)', [
          [own, shared],
        ]),
      )
    ).rows[0]!.count
    expect(versions).toBe(2)
    for (const page of [single, first, second]) {
      const draft = (
        await db.asUser(s.superAdmin, client =>
          client.query('SELECT draft_version_id FROM pages WHERE id=$1', [page.id]),
        )
      ).rows[0]!.draft_version_id
      expect(draft).toBe(page.versionId)
    }
  })
})
