import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SEED_SECTION_DEFS } from '@cms/seeds'
import { StructuredDocument } from '@cms/schema'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'

let db: TestDatabase
let s: Scenario
let actor: string
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/lib/session.ts', () => ({
  currentSession: async () => ({ principal: { userId: actor } }),
  authProvider: vi.fn(),
}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import {
  compileSectionDraft,
  saveSectionDefinition,
  type SectionDraft,
} from '../src/app/actions/section-definitions.ts'
import { getGlobalElementsWorkspace } from '../src/lib/queries.ts'
import { listFrameLibrary } from '../src/lib/frame-library.ts'
import { setFrameLibraryStatus } from '../src/app/sites/[siteId]/sections/frames/actions.ts'
import { compileDefinitionDraft, type AuthoredCompilation } from '../src/lib/definition-compiler.ts'

beforeAll(async () => {
  db = await TestDatabase.create('frame_authoring')
  s = await seedScenario(db)
  actor = s.superAdmin
})
afterAll(async () => {
  await db?.close()
})

function draft(slug: string): SectionDraft {
  return {
    slug,
    name: `Frame ${slug}`,
    category: 'Site frame',
    siteId: s.siteA,
    scope: 'site',
    placement: 'header',
    sourceHtml: '<div><strong>{{title}}</strong><nav>{{menu}}</nav></div>',
    sourceCss: 'strong{font-weight:bold}',
    slots: [
      { id: 'title', kind: 'text', label: 'Title' },
      { id: 'menu', kind: 'navigation', label: 'Site menu' },
    ],
    changelog: 'Synthetic frame fixture',
    expectedVersion: 0,
  }
}
async function def(slug: string) {
  return (await db.asUser(s.superAdmin, client => client.query('SELECT * FROM section_defs WHERE slug=$1', [slug])))
    .rows[0]!
}

/** Exercise the database boundary without relying on the server compiler. */
async function rawFrame(slug: string, compiled: AuthoredCompilation, sourceHtml = compiled.sourceHtml) {
  return db.asUser(s.superAdmin, async client => {
    const row = (
      await client.query<{ section_def_id: string }>(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          slug,
          slug,
          'Frame',
          sourceHtml,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(compiled.slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Synthetic direct API fixture',
          false,
          compiled.kind,
          compiled.structuredDoc ? JSON.stringify(compiled.structuredDoc) : null,
          compiled.schemaVersion,
          'site',
          s.siteA,
        ],
      )
    ).rows[0]!
    await client.query("SELECT app.set_section_def_placement($1,'header')", [row.section_def_id])
    return row.section_def_id
  })
}

async function expectUnready(id: string, reason: RegExp) {
  const content = {
    schemaVersion: 2,
    enabled: true,
    sticky: false,
    component: { section_def_id: id, section_def_version: 1, values: {} },
  }
  expect(
    (
      await db.asUser(s.superAdmin, client =>
        client.query("SELECT app.preview_global_component($1,'header',$2) AS component", [
          s.siteA,
          JSON.stringify(content),
        ]),
      )
    ).rows[0]?.component,
  ).toBeNull()
  const before = (await getGlobalElementsWorkspace(s.superAdmin, s.siteA))!
  await expect(
    db.asUser(s.superAdmin, async client => {
      const saved = (
        await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
          s.siteA,
          before.header.revision,
          before.footer.revision,
          JSON.stringify(content),
          JSON.stringify(before.footer.draft),
        ])
      ).rows[0]!
      await client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        s.siteA,
        saved.header_revision,
        saved.footer_revision,
      ])
    }),
  ).rejects.toThrow(reason)
  const after = (await getGlobalElementsWorkspace(s.superAdmin, s.siteA))!
  expect(after.header.draftVersionId).toBe(before.header.draftVersionId)
  expect(after.header.publishedVersionId).toBe(before.header.publishedVersionId)
}

describe('authored frame creator and lifecycle', () => {
  it('previews a governed menu inside the real header landmark, then saves its placement atomically', async () => {
    actor = s.superAdmin
    const report = await compileSectionDraft(draft('authored-menu'))
    expect(report.ok).toBe(true)
    expect(report.previewHtml).toContain('cms-frame--header')
    expect(report.previewHtml).toContain('cms-section--authored-menu')
    expect(report.previewHtml).not.toContain('{{menu}}')
    expect(await saveSectionDefinition(draft('authored-menu'))).toMatchObject({ ok: true, revision: 1 })
    expect(await def('authored-menu')).toMatchObject({ placement: 'header', status: 'active' })
  })

  it('refuses navigation in page sections and in an attribute context', async () => {
    expect(await compileSectionDraft({ ...draft('bad-page-menu'), placement: 'page' })).toMatchObject({ ok: false })
    expect(await saveSectionDefinition({ ...draft('bad-page-menu'), placement: 'page' })).toMatchObject({ ok: false })
    expect(
      await compileSectionDraft({ ...draft('bad-attr-menu'), sourceHtml: '<div title="{{menu}}">{{title}}</div>' }),
    ).toMatchObject({ ok: false })
  })

  it('rolls back creation when a site admin tries to grant frame placement', async () => {
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'site_admin']),
    )
    actor = s.editorA
    expect(await saveSectionDefinition(draft('forbidden-frame'))).toMatchObject({ ok: false })
    expect(await def('forbidden-frame')).toBeUndefined()
    actor = s.superAdmin
  })

  it('retains a retired pinned component and its fields in the workspace, without publishing changes', async () => {
    const row = await def('authored-menu')
    const workspace = (await getGlobalElementsWorkspace(s.superAdmin, s.siteA))!
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        s.siteA,
        workspace.header.revision,
        workspace.footer.revision,
        JSON.stringify({
          schemaVersion: 2,
          enabled: true,
          sticky: false,
          component: {
            section_def_id: row.id,
            section_def_version: 1,
            values: { title: 'Pinned title' },
          },
        }),
        JSON.stringify(workspace.footer.draft),
      ]),
    )
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'retired')).toMatchObject({ ok: true })
    const retired = (await getGlobalElementsWorkspace(s.superAdmin, s.siteA))!
    expect(retired.components.find(entry => entry.id === row.id)).toMatchObject({
      status: 'retired',
      versions: [{ version: 1 }],
    })
    expect(retired.header.draft).toMatchObject({ component: { values: { title: 'Pinned title' } } })
    expect(retired.header.publishedVersionId).toBe(workspace.header.publishedVersionId)
    expect((await listFrameLibrary(s.superAdmin, s.siteA)).find(entry => entry.id === row.id)).toMatchObject({
      status: 'retired',
      usedOnSites: 1,
    })
    expect(await listFrameLibrary(s.editorA, s.siteA)).toEqual([])
    actor = s.editorA
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'active')).toMatchObject({ ok: false })
    actor = s.superAdmin
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'active')).toMatchObject({ ok: true })
  })

  it('refuses placement changes once pinned without appending an unwanted version', async () => {
    const row = await def('authored-menu')
    const next = { ...draft('authored-menu'), definitionId: row.id, expectedVersion: 1, placement: 'footer' as const }
    expect(await saveSectionDefinition(next)).toMatchObject({ ok: false })
    const versions = await db.asUser(s.superAdmin, client =>
      client.query('SELECT version FROM section_def_versions WHERE section_def_id=$1', [row.id]),
    )
    expect(versions.rows).toEqual([{ version: 1 }])
    expect((await def('authored-menu')).placement).toBe('header')
  })

  it('reserves a retired shared frame’s stylesheet scope against new site sections', async () => {
    actor = s.superAdmin
    const shared = { ...draft('reserved-frame-scope'), scope: 'global' as const }
    expect(await saveSectionDefinition(shared)).toMatchObject({ ok: true })
    const row = await def('reserved-frame-scope')
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'retired')).toMatchObject({ ok: true })
    const conflicting = {
      ...draft('reserved-frame-scope'),
      placement: 'page' as const,
      sourceHtml: '<p>{{title}}</p>',
      slots: [{ id: 'title', kind: 'text', label: 'Title' }],
    }
    expect(await saveSectionDefinition(conflicting)).toMatchObject({ ok: false })
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'active')).toMatchObject({ ok: true })
  })

  it('independently refuses publishing a collection-backed frame created through the SQL placement command', async () => {
    actor = s.superAdmin
    const source = SEED_SECTION_DEFS.find(def => def.slug === 'speakers-listing')!
    if (source.kind !== 'structured') throw new Error('structured fixture required')
    const input: SectionDraft = {
      ...draft('frame-repeat-gate'),
      placement: 'page',
      definitionKind: 'structured',
      sourceHtml: '',
      sourceCss: source.sourceCss,
      slots: [],
      structuredDoc: StructuredDocument.parse({ schemaVersion: 3, fields: source.fields, nodes: source.nodes }),
    }
    expect(await saveSectionDefinition(input)).toMatchObject({ ok: true })
    const row = await def('frame-repeat-gate')
    await db.asUser(actor, client => client.query("SELECT app.set_section_def_placement($1,'header')", [row.id]))
    await expectUnready(row.id, /collection lists/)
  })

  it('does not show an unpinned retired definition or let a page definition use frame lifecycle commands', async () => {
    expect(await saveSectionDefinition(draft('unused-frame'))).toMatchObject({ ok: true })
    const row = await def('unused-frame')
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'retired')).toMatchObject({ ok: true })
    expect(
      (await getGlobalElementsWorkspace(s.superAdmin, s.siteA))!.components.some(entry => entry.id === row.id),
    ).toBe(false)
    expect(await setFrameLibraryStatus(s.siteA, s.heroDefId, 'retired')).toMatchObject({ ok: false })
    expect(await setFrameLibraryStatus(s.siteB, row.id, 'active')).toMatchObject({ ok: false })
  })

  it('records one audit event per real lifecycle change and makes repeated requests harmless', async () => {
    expect(await saveSectionDefinition(draft('idempotent-frame'))).toMatchObject({ ok: true })
    const row = await def('idempotent-frame')
    for (const status of ['retired', 'retired', 'active', 'active'] as const) {
      expect(await setFrameLibraryStatus(s.siteA, row.id, status)).toMatchObject({ ok: true })
    }
    const audits = await db.asUser(s.superAdmin, client =>
      client.query(
        "SELECT action FROM audit_log WHERE item_id=$1 AND action IN ('section_def.retired','section_def.active') ORDER BY created_at",
        [row.id],
      ),
    )
    expect(audits.rows).toEqual([{ action: 'section_def.retired' }, { action: 'section_def.active' }])
  })

  it('keeps retired pinned fields readable to site editors and rejects malformed lifecycle inputs', async () => {
    const row = await def('authored-menu')
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'retired')).toMatchObject({ ok: true })
    expect(
      (await getGlobalElementsWorkspace(s.editorA, s.siteA))!.components.find(entry => entry.id === row.id),
    ).toMatchObject({ status: 'retired', versions: [{ version: 1 }] })
    expect(await setFrameLibraryStatus('not-a-site', row.id, 'active')).toMatchObject({ ok: false })
    expect(await setFrameLibraryStatus(s.siteA, 'not-a-definition', 'active')).toMatchObject({ ok: false })
    expect(await setFrameLibraryStatus(s.siteA, row.id, 'hidden' as 'active')).toMatchObject({ ok: false })
    expect((await def('authored-menu')).status).toBe('retired')
  })

  it.each([
    ['source-script', '<script>alert(1)</script>', ['<div>Safe compiled output</div>']],
    ['ast-script', '<div>Safe source</div>', ['<script>alert(1)</script>']],
    ['split-script', '<div>Safe source</div>', ['<scr', 'ipt>alert(1)</scr', 'ipt>']],
    ['event-attribute', '<div>Safe source</div>', ['<img src="/ok.png" onerror="alert(1)">']],
    ['active-url', '<div>Safe source</div>', ['<a href="javascript:alert(1)">Go</a>']],
  ])('refuses %s frame publication even with a forged false trusted marker', async (suffix, source, nodes) => {
    const slug = `unmarked-${suffix}`
    const compiled = compileDefinitionDraft({
      ...draft(slug),
      sourceHtml: '<div>Safe frame</div>',
      sourceCss: '',
      slots: [],
    })
    compiled.ast.nodes = (nodes as string[]).map(value => ({ kind: 'html', value }))
    await expectUnready(await rawFrame(slug, compiled, source as string), /active markup|custom scripts/)
  })

  it('refuses a hidden structured collection binding even if the submitted slots omit it', async () => {
    const source = SEED_SECTION_DEFS.find(entry => entry.slug === 'speakers-listing')!
    if (source.kind !== 'structured') throw new Error('Expected the code-owned collection fixture')
    const slug = 'hidden-frame-collection'
    const compiled = compileDefinitionDraft({
      ...draft(slug),
      placement: 'page',
      definitionKind: 'structured',
      slots: [],
      sourceCss: source.sourceCss,
      structuredDoc: StructuredDocument.parse({ schemaVersion: 3, fields: source.fields, nodes: source.nodes }),
    })
    expect(compiled.blocking).toEqual([])
    compiled.slots = []
    await expectUnready(await rawFrame(slug, compiled), /collection lists/)
  })
})
