import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mapErrors } from '@cms/domain'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import type { StructuredDocument } from '@cms/schema'
import {
  addBuilderBlock,
  BUILDER_CSS,
  moveBuilderNode,
  newStructuredSection,
  removeBuilderNode,
} from '../src/lib/structured-builder.ts'
import { visualSourceCss } from '../src/lib/visual-authoring.ts'
import { compileDefinitionDraft } from '../src/lib/definition-compiler.ts'

let db: TestDatabase, s: Scenario, actor: string, siteAdmin: string
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/lib/session.ts', () => ({
  currentSession: async () => ({ principal: { userId: actor } }),
  authProvider: vi.fn(),
}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import {
  checkCustomCss,
  compileSectionDraft,
  saveSectionDefinition,
  type SectionDraft,
} from '../src/app/actions/section-definitions.ts'

beforeAll(async () => {
  db = await TestDatabase.create('visual_roles')
  s = await seedScenario(db)
  siteAdmin = await db.asUser(s.superAdmin, async client => {
    const user = (await client.query("SELECT app.provision_user('visual-admin@example.test','Visual admin') AS id"))
      .rows[0]!.id
    await client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [user, s.siteA])
    return user
  })
  actor = siteAdmin
})
afterAll(async () => {
  await db?.close()
})
function draft(overrides: Partial<SectionDraft> = {}): SectionDraft {
  return {
    slug: `visual-${randomUUID().slice(0, 8)}`,
    name: 'Visual section',
    category: 'Content',
    sourceHtml: '',
    sourceCss: BUILDER_CSS,
    slots: [],
    scope: 'site',
    siteId: s.siteA,
    placement: 'page',
    definitionKind: 'structured',
    structuredDoc: newStructuredSection(),
    changelog: 'Role boundary',
    expectedVersion: 0,
    ...overrides,
  }
}
function args(input: SectionDraft, compiled = compileDefinitionDraft(input)) {
  return [
    input.slug,
    input.name,
    input.category,
    compiled.sourceHtml,
    input.sourceCss,
    compiled.css,
    JSON.stringify(compiled.ast),
    JSON.stringify(compiled.slots),
    compiled.renderHash,
    compiled.ast.policyVersion,
    compiled.ast.cssPolicyVersion,
    input.changelog,
    compiled.carriesTrustedCode,
    compiled.kind,
    compiled.structuredDoc ? JSON.stringify(compiled.structuredDoc) : null,
    compiled.schemaVersion,
    input.scope,
    input.scope === 'site' ? input.siteId : null,
  ]
}
const sql =
  'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)'
async function raw(input: SectionDraft, changes?: (parameters: unknown[]) => void, user = siteAdmin) {
  const parameters = args(input)
  changes?.(parameters)
  return db.asUser(user, client => client.query(sql, parameters))
}
async function check(input: SectionDraft) {
  const compiled = compileDefinitionDraft(input)
  await db.asUser(actor, client =>
    client.query('SELECT app.check_section_authoring($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      input.slug,
      input.siteId,
      input.scope,
      compiled.kind,
      input.sourceHtml,
      input.sourceCss,
      compiled.css,
      JSON.stringify(compiled.ast),
      JSON.stringify(compiled.slots),
      JSON.stringify(compiled.structuredDoc),
      compiled.carriesTrustedCode,
      input.placement ?? 'page',
    ]),
  )
}
async function latest(slug: string) {
  return (
    await db.asUser(s.superAdmin, client =>
      client.query(
        'SELECT v.*,d.id,d.placement FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug=$1 ORDER BY v.version DESC LIMIT 1',
        [slug],
      ),
    )
  ).rows[0]!
}

describe('role-bounded definition authoring', () => {
  it('provides custom CSS authoring feedback only to a current super admin', async () => {
    for (const user of [siteAdmin, s.editorA, s.contributorA, s.editorB, s.disabled]) {
      actor = user
      expect(await checkCustomCss('.hero{color:navy}', 0)).toMatchObject({
        ok: false,
        blocking: [expect.stringMatching(/super admin/)],
      })
    }
    actor = s.superAdmin
    expect(await checkCustomCss('.hero{color:navy}', 0)).toMatchObject({ ok: true, blocking: [] })
  })
  it('lets a site admin preview/create/revise visual blocks without changing existing page pins', async () => {
    actor = siteAdmin
    const input = draft()
    expect((await compileSectionDraft(input)).ok).toBe(true)
    expect(await saveSectionDefinition(input)).toMatchObject({ ok: true, revision: 1 })
    const old = await latest(input.slug)
    const pinned = await db.asUser(s.editorA, async client => {
      const id = (
        await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, input.slug, 'Pinned visual page'])
      ).rows[0]!.id
      return (
        await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          id,
          JSON.stringify([
            {
              section_def_id: old.id,
              section_def_version: 1,
              values: { heading: 'Original' },
              hidden: false,
              hidden_at: [],
            },
          ]),
          '{}',
        ])
      ).rows[0]!.version_id
    })
    let doc = addBuilderBlock(input.structuredDoc as StructuredDocument, [0], 'columns')
    doc = addBuilderBlock(doc, [0, 2, 0], 'image')
    doc = addBuilderBlock(doc, [0, 2, 1], 'icon')
    doc = moveBuilderNode(doc, [0, 0], 1)
    doc.fields[0]!.label = 'Updated heading'
    const next = {
      ...input,
      structuredDoc: doc,
      sourceCss: visualSourceCss(doc, old.source_css),
      expectedVersion: 1,
      definitionId: old.id,
    }
    await check(next)
    expect((await compileSectionDraft(next)).ok).toBe(true)
    expect(await saveSectionDefinition(next)).toMatchObject({ ok: true, revision: 2 })
    expect(
      (await db.asUser(s.editorA, client => client.query('SELECT content FROM page_versions WHERE id=$1', [pinned])))
        .rows[0]!.content[0].section_def_version,
    ).toBe(1)
    expect(await saveSectionDefinition(next)).toMatchObject({ ok: false, kind: 'conflict' })
    expect((await latest(input.slug)).version).toBe(2)
  })

  it.each(['html', 'css', 'structured_css', 'frame', 'shared', 'json_attribute', 'json_embed'] as const)(
    'refuses a site admin %s source submission in preview and save',
    async variant => {
      const input = draft()
      if (variant === 'html') {
        input.definitionKind = 'legacy'
        input.sourceHtml = '<h1>Advanced</h1>'
        input.sourceCss = ''
      }
      if (variant === 'css') input.sourceCss += '.builder-root{color:red}'
      if (variant === 'structured_css') input.sourceHtml = '<p>Hidden source</p>'
      if (variant === 'frame') input.placement = 'header'
      if (variant === 'shared') input.scope = 'global'
      if (variant === 'json_attribute')
        (input.structuredDoc as StructuredDocument).nodes = [
          { type: 'element', tag: 'div', attributes: { id: 'injected' }, children: [] },
        ]
      if (variant === 'json_embed')
        (input.structuredDoc as StructuredDocument).nodes = [{ type: 'element', tag: 'h1', children: [] }]
      actor = siteAdmin
      expect((await compileSectionDraft(input)).ok).toBe(false)
      expect(await saveSectionDefinition(input)).toMatchObject({ ok: false })
      expect(await latest(input.slug)).toBeUndefined()
    },
  )

  it.each(['source_css', 'compiled_css', 'source_html', 'trusted', 'ast', 'slots'] as const)(
    'refuses direct database %s forgery',
    async artifact => {
      const input = draft()
      await expectSqlState(
        raw(input, parameters => {
          if (artifact === 'source_css') parameters[4] = BUILDER_CSS + '.builder-root{color:red}'
          if (artifact === 'compiled_css')
            parameters[5] = String(parameters[5]) + `.cms-section--${input.slug}{color:red}`
          if (artifact === 'source_html') parameters[3] = '<div>Forbidden raw source</div>'
          if (artifact === 'trusted') parameters[12] = true
          if (artifact === 'ast')
            parameters[6] = JSON.stringify({
              ...compileDefinitionDraft(input).ast,
              nodes: [{ kind: 'html', value: '<h1>Forged</h1>' }],
            })
          if (artifact === 'slots')
            parameters[7] = JSON.stringify([{ id: 'heading', kind: 'richtext', label: 'Forged', constraints: {} }])
        }),
        'CMS02',
      )
      expect(await latest(input.slug)).toBeUndefined()
    },
  )

  it('carries a super-admin custom structured design forward through bounded visual edits', async () => {
    actor = s.superAdmin
    const doc: StructuredDocument = {
      schemaVersion: 3,
      fields: [{ name: 'title', type: 'text', label: 'Title' }],
      nodes: [
        {
          type: 'element',
          tag: 'article',
          attributes: { class: 'approved-design', 'aria-label': 'Approved' },
          children: [{ type: 'element', tag: 'h1', children: [{ type: 'text', field: 'title' }] }],
        },
      ],
    }
    const input = draft({ structuredDoc: doc, sourceCss: '.approved-design{padding:2rem;color:#003087}' })
    expect(await saveSectionDefinition(input)).toMatchObject({ ok: true, revision: 1 })
    const old = await latest(input.slug)
    let next = addBuilderBlock(doc, [0], 'link')
    next = addBuilderBlock(next, [0], 'columns')
    next.fields[0]!.label = 'Renamed title'
    actor = siteAdmin
    const revision = {
      ...input,
      structuredDoc: next,
      sourceCss: visualSourceCss(next, old.source_css),
      definitionId: old.id,
      expectedVersion: 1,
    }
    await check(revision)
    expect((await compileSectionDraft(revision)).ok).toBe(true)
    expect(await saveSectionDefinition(revision)).toMatchObject({ ok: true, revision: 2 })
    const saved = await latest(input.slug)
    expect(saved.source_css.startsWith(old.source_css)).toBe(true)
    expect(saved.compiled_css.startsWith(old.compiled_css)).toBe(true)
    const removed = removeBuilderNode(next, [0, 1])
    expect(
      await saveSectionDefinition({
        ...revision,
        structuredDoc: removed,
        sourceCss: visualSourceCss(removed, saved.source_css),
        expectedVersion: 2,
      }),
    ).toMatchObject({ ok: true, revision: 3 })
    const changed = structuredClone(removed)
    ;(changed.nodes[0] as { attributes: Record<string, string> }).attributes['aria-label'] = 'Changed source'
    expect(
      await saveSectionDefinition({
        ...revision,
        structuredDoc: changed,
        sourceCss: visualSourceCss(changed, saved.source_css),
        expectedVersion: 3,
      }),
    ).toMatchObject({ ok: false })
  })

  it('retains legacy definitions and allows their source to be revised only by super admins', async () => {
    const input = draft({
      definitionKind: 'legacy',
      sourceHtml: '<h1>{{title}}</h1>',
      sourceCss: 'h1{color:navy}',
      slots: [{ id: 'title', kind: 'text', label: 'Title' }],
    })
    actor = s.superAdmin
    expect(await saveSectionDefinition(input)).toMatchObject({ ok: true, revision: 1 })
    const old = await latest(input.slug)
    const next = { ...input, definitionId: old.id, expectedVersion: 1, sourceHtml: '<h1>Updated {{title}}</h1>' }
    actor = siteAdmin
    expect((await compileSectionDraft(next)).ok).toBe(false)
    expect(await saveSectionDefinition(next)).toMatchObject({ ok: false })
    await expectSqlState(raw(input, undefined, siteAdmin), 'CMS02')
    // A forged conversion cannot turn existing advanced source into a visual draft.
    await expectSqlState(raw(draft({ slug: input.slug }), undefined, siteAdmin), 'CMS02')
    actor = s.superAdmin
    expect(await saveSectionDefinition(next)).toMatchObject({ ok: true, revision: 2 })
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query('SELECT source_html FROM section_def_versions WHERE section_def_id=$1 AND version=1', [old.id]),
        )
      ).rows[0]!.source_html,
    ).toBe(input.sourceHtml)
  })

  it('denies ordinary editors, contributors, outsiders and disabled users before preview or write', async () => {
    for (const user of [s.editorA, s.contributorA, s.editorB, s.disabled]) {
      actor = user
      const input = draft()
      expect((await compileSectionDraft(input)).ok).toBe(false)
      expect(await saveSectionDefinition(input)).toMatchObject({ ok: false })
      await expectSqlState(raw(input, undefined, user), 'CMS02')
    }
    actor = siteAdmin
    const foreign = draft({ siteId: s.siteB })
    expect((await compileSectionDraft(foreign)).ok).toBe(false)
    await expectSqlState(raw(foreign), 'CMS02')
  })

  it('requires a change note without losing the previewable visual draft', async () => {
    actor = siteAdmin
    const input = draft({ changelog: '   ' })
    expect((await compileSectionDraft(input)).ok).toBe(true)
    expect(await saveSectionDefinition(input)).toMatchObject({
      ok: false,
      message: 'Describe what changed before saving this section.',
    })
    expect(await latest(input.slug)).toBeUndefined()
    expect(await saveSectionDefinition({ ...input, changelog: 'Add responsive content blocks' })).toMatchObject({
      ok: true,
      revision: 1,
    })
  })

  it('keeps the old implementation and style helpers private from runtime roles', async () => {
    const input = draft(),
      parameters = args(input)
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, client => client.query(sql, parameters)),
        '42501',
      )
    await expectSqlState(
      db.asUser(siteAdmin, client =>
        client.query(
          sql.replace('app.upsert_section_def_version(', 'app.upsert_section_def_version_before_visual_roles('),
          parameters,
        ),
      ),
      '42501',
    )
    await expectSqlState(
      db.asUser(siteAdmin, client => client.query('SELECT * FROM app.visual_builder_styles()')),
      '42501',
    )
  })
})
