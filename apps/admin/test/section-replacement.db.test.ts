import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compileSection } from '@cms/renderer'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'

let db: TestDatabase
let s: Scenario
let actor: string
let feature: string, header: string, foreign: string
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/lib/session.ts', () => ({ currentSession: async () => ({ principal: { userId: actor } }) }))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import {
  applySectionReplacement,
  previewSectionReplacement,
  listCompatibleSectionLayouts,
} from '../src/app/pages/[pageId]/section-replacement-actions.ts'

async function definition(
  slug: string,
  html: string,
  slots: { id: string; kind: 'text' | 'link'; label: string }[],
  placement = 'page',
  site: string | null = null,
) {
  const id = await db.asUser(s.superAdmin, async client => {
    const fields = slots.map(slot => ({ ...slot, constraints: {} }))
    const compiled = compileSection({
      sourceHtml: html,
      sourceCss: '',
      slots: fields,
      scopeSelector: `.cms-section--${slug}`,
    })
    expect(compiled.blocking).toEqual([])
    const id = (
      await client.query(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          slug,
          slug,
          'Layouts',
          html,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(fields),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Layout replacement fixture',
        ],
      )
    ).rows[0]!.section_def_id as string
    if (placement !== 'page') await client.query('SELECT app.set_section_def_placement($1,$2)', [id, placement])
    return id
  })
  // After the creating transaction commits, so the owner connection can see it.
  if (site)
    await db.as('owner', owner =>
      owner.query("UPDATE section_defs SET scope='site',site_id=$2 WHERE id=$1", [id, site]),
    )
  return id
}
async function head() {
  return (
    await db.asUser(s.editorA, client =>
      client.query(
        `SELECT p.revision,p.draft_version_id,p.published_version_id,v.content,v.kind,v.note
    FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1`,
        [s.pageA],
      ),
    )
  ).rows[0]!
}
const request = (sourceVersionId: string, extra: Record<string, unknown> = {}) => ({
  pageId: s.pageA,
  sourceVersionId,
  index: 0,
  targetDefinitionId: feature,
  ...extra,
})

beforeAll(async () => {
  db = await TestDatabase.create('section_replacement')
  s = await seedScenario(db)
  actor = s.editorA
  feature = await definition('feature-band', '<section><h2>{{title}}</h2><p>{{heading}}</p>{{cta}}</section>', [
    { id: 'title', kind: 'text', label: 'Title' },
    { id: 'heading', kind: 'text', label: 'Kicker' },
    { id: 'cta', kind: 'link', label: 'Call to action' },
  ])
  header = await definition(
    'replacement-header',
    '<header><p>{{heading}}</p></header>',
    [{ id: 'heading', kind: 'text', label: 'Heading' }],
    'header',
  )
  foreign = await definition(
    'other-site-band',
    '<section><p>{{heading}}</p></section>',
    [{ id: 'heading', kind: 'text', label: 'Heading' }],
    'page',
    s.siteB,
  )
  const hero = (heading: string, extra: Record<string, unknown> = {}) => ({
    section_def_id: s.heroDefId,
    section_def_version: 1,
    values: { heading, intro: `${heading} introduction` },
    hidden: false,
    hidden_at: [],
    label: 'Hero',
    ...extra,
  })
  const content = [hero('Spring appeal heading', { label: 'Spring appeal', hidden_at: ['sm'] }), hero('Second section')]
  await db.asUser(actor, client =>
    client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      s.pageA,
      JSON.stringify(content),
      JSON.stringify({ title: 'Home', noindex: true }),
    ]),
  )
  await db.asUser(actor, client =>
    client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN]),
  )
})
afterAll(async () => {
  await db?.close()
})

describe('changing one section to a different layout against real database roles', () => {
  it('previews exact field mapping without saving anything', async () => {
    const before = await head()
    const preview = await previewSectionReplacement(request(before.draft_version_id))
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.sectionLabel).toBe('Spring appeal')
    expect(preview.target).toMatchObject({ definitionId: feature, name: 'feature-band', version: 1 })
    expect(preview.fields.map(field => [field.id, field.sourceId, field.choices.map(choice => choice.id)])).toEqual([
      ['title', null, ['heading', 'intro']],
      ['heading', 'heading', ['heading', 'intro']],
      ['cta', null, []],
    ])
    expect(preview.unmapped).toEqual(['Intro'])
    // Appearance carry-over is covered by the unit tests: this legacy layout cannot hold any.
    expect(preview.droppedAppearance).toEqual([])
    expect(preview.droppedSource).toBe(false)
    expect(preview.beforeHtml).toContain('Spring appeal heading introduction')
    expect(preview.html).toContain('<p>Spring appeal heading</p>')
    expect(preview.html).not.toContain('Spring appeal heading introduction')
    expect(preview.html).toContain('Second section introduction')
    const mapped = await previewSectionReplacement(
      request(before.draft_version_id, { mapping: { title: 'intro', heading: null } }),
    )
    if (!mapped.ok) throw new Error(mapped.message)
    expect(mapped.html).toContain('<h2>Spring appeal heading introduction</h2>')
    expect(mapped.unmapped).toEqual(['Heading'])
    expect(await head()).toEqual(before)
  })

  it('refuses incompatible or forged mappings, frame layouts, other sites’ layouts and the same layout', async () => {
    const { draft_version_id: version } = await head()
    for (const extra of [
      { mapping: { cta: 'heading' } },
      { mapping: { missing: null } },
      { mapping: ['title'] },
      { targetDefinitionId: header },
      { targetDefinitionId: foreign },
      { targetDefinitionId: s.heroDefId },
      { index: 9 },
    ]) {
      expect({ extra, ok: (await previewSectionReplacement(request(version, extra))).ok }).toEqual({ extra, ok: false })
    }
    actor = s.editorB
    try {
      expect(await previewSectionReplacement(request(version))).toMatchObject({ ok: false })
    } finally {
      actor = s.editorA
    }
  })

  it('saves a checkpoint, changes only the chosen section, and returns what the editor applies', async () => {
    const before = await head()
    const result = await applySectionReplacement(
      request(before.draft_version_id, { mapping: { title: 'intro' } }),
      Number(before.revision),
    )
    if (!result.ok) throw new Error(result.message)
    const after = await head()
    expect(after.draft_version_id).toBe(result.versionId)
    expect(after.published_version_id).toBe(before.published_version_id)
    expect(after.content[0]).toEqual(result.section)
    expect(result.section).toEqual({
      section_def_id: feature,
      section_def_version: 1,
      label: 'Spring appeal',
      hidden: false,
      hidden_at: ['sm'],
      values: { title: 'Spring appeal heading introduction', heading: 'Spring appeal heading' },
    })
    expect(after.content[1]).toEqual(before.content[1])
    expect(after.note).toBe('Changed “Spring appeal” from Hero to feature-band')
    expect(result.definition).toMatchObject({
      section_def_id: feature,
      version: 1,
      placement: 'page',
      slots: [{ id: 'title' }, { id: 'heading' }, { id: 'cta' }],
    })
    const kept = (
      await db.asUser(actor, client =>
        client.query(
          "SELECT content,note FROM page_versions WHERE page_id=$1 AND kind='checkpoint' ORDER BY revision DESC LIMIT 2",
          [s.pageA],
        ),
      )
    ).rows
    expect(kept[1]).toEqual({ content: before.content, note: 'Before changing the layout of “Spring appeal”' })
  })

  it('refuses a reviewed change once the draft has moved, and keeps another site’s editor out', async () => {
    const latest = await head()
    expect(
      await applySectionReplacement(
        { pageId: s.pageA, sourceVersionId: latest.draft_version_id, index: 1, targetDefinitionId: feature },
        Number(latest.revision) - 1,
      ),
    ).toMatchObject({ ok: false, kind: 'conflict' })
    actor = s.editorB
    try {
      expect(
        await applySectionReplacement(
          { pageId: s.pageA, sourceVersionId: latest.draft_version_id, index: 1, targetDefinitionId: feature },
          Number(latest.revision),
        ),
      ).toMatchObject({ ok: false })
    } finally {
      actor = s.editorA
    }
    expect(await head()).toEqual(latest)
  })
})

it('offers actual-content previews only for renderable choices, excluding frame, current and foreign layouts', async () => {
  const before = await head()
  const choices = await listCompatibleSectionLayouts({
    pageId: s.pageA,
    sourceVersionId: before.draft_version_id,
    index: 0,
  })
  expect(choices.ok).toBe(true)
  if (!choices.ok) throw new Error(choices.message)
  const ids = choices.options.map(option => option.definition.section_def_id)
  expect(ids).not.toContain(header)
  expect(ids).not.toContain(foreign)
  for (const option of choices.options) {
    expect(option.html).toContain('<main')
    expect(option.html).not.toContain('<header')
  }
})
