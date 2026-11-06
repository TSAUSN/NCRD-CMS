import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let sameSiteEditor: string

const systemFont = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const serifFont = "Georgia, 'Times New Roman', serif"

const TOKENS = {
  colors: {
    primary: '#003087',
    accent: '#c8102e',
    surface: '#ffffff',
    surfaceAlt: '#f4f6f8',
    ink: '#1a1a1a',
    muted: '#5f6872',
    primaryContrast: '#ffffff',
    accentContrast: '#ffffff',
  },
  fonts: { heading: serifFont, body: systemFont },
  radius: '0.5rem',
  spacing: 'comfortable',
  buttons: {
    style: 'solid',
    color: 'primary',
    radius: '0.5rem',
    weight: 'bold',
    hover: 'darken',
    speed: 'normal',
  },
} as const

beforeAll(async () => {
  db = await TestDatabase.create('theme')
  s = await seedScenario(db)
  sameSiteEditor = await db.asUser(s.superAdmin, async client => {
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'site_admin'])
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorB, s.siteB, 'site_admin'])
    const id = (
      await client.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [
        'theme-editor@example.test',
        'Theme editor',
      ])
    ).rows[0]!.id
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [id, s.siteA, 'editor'])
    return id
  })
})
afterAll(async () => {
  await db?.close()
})

async function themeHead(siteId = s.siteA) {
  return db.asUser(
    siteId === s.siteA ? s.editorA : s.editorB,
    async client =>
      (
        await client.query<{
          id: string
          revision: string
          draft_version_id: string
          published_version_id: string
          draft: Record<string, unknown>
          published: Record<string, unknown>
        }>(
          `SELECT t.id, t.revision, t.draft_version_id, t.published_version_id,
            draft.tokens AS draft, live.tokens AS published
       FROM themes t
       JOIN theme_versions draft ON draft.id = t.draft_version_id
       JOIN theme_versions live ON live.id = t.published_version_id
      WHERE t.site_id = $1`,
          [siteId],
        )
      ).rows[0]!,
  )
}

async function save(tokens: unknown, expectedRevision?: number) {
  const revision = expectedRevision ?? Number((await themeHead()).revision)
  return db.asUser(s.editorA, client =>
    client.query<{
      version_id: string
      revision: string
    }>('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteA, revision, JSON.stringify(tokens)]),
  )
}

describe('the theme workspace is a private-draft, versioned site artifact', () => {
  it('keeps legacy rows readable and upgrades by adding a new normalized version', async () => {
    const before = await themeHead(s.siteB)
    expect(before.published).toEqual({
      colors: { primary: '#003087', surface: '#ffffff', ink: '#1a1a1a' },
      fonts: { heading: serifFont, body: 'system-ui, sans-serif' },
      radius: '0.5rem',
    })

    const saved = await db.asUser(s.editorB, client =>
      client.query<{
        version_id: string
        revision: string
      }>('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteB, before.revision, JSON.stringify(TOKENS)]),
    )
    const after = await themeHead(s.siteB)
    expect(after.published_version_id).toBe(before.published_version_id)
    expect(after.published).toEqual(before.published)
    expect(after.draft).toEqual(TOKENS)
    expect(after.draft_version_id).toBe(saved.rows[0]!.version_id)

    const old = await db.asUser(s.editorB, client =>
      client.query<{ tokens: unknown }>('SELECT tokens FROM theme_versions WHERE id = $1', [
        before.published_version_id,
      ]),
    )
    expect(old.rows[0]!.tokens).toEqual(before.published)
  })

  it('saves privately, publishes immutably, rebuilds the shell, audits, and invalidates every route', async () => {
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        0,
        heroContent(s.heroDefId, 'Home'),
        '{}',
      ]),
    )
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN]),
    )
    await db.as('owner', client => client.query('SELECT app.ensure_site_shell($1)', [s.siteA]))

    const before = await themeHead()
    const saved = await save(TOKENS, Number(before.revision))
    const privateHead = await themeHead()
    expect(privateHead.published_version_id).toBe(before.published_version_id)
    expect(privateHead.published).toEqual(before.published)
    expect(privateHead.draft).toEqual(TOKENS)

    const privateShell = await db.asUser(s.editorA, client =>
      client.query<{ tokens: unknown }>(
        "SELECT payload->'theme' AS tokens FROM published_site_shells WHERE site_id = $1",
        [s.siteA],
      ),
    )
    expect(privateShell.rows[0]!.tokens).toEqual(before.published)

    const published = await db.asUser(s.editorA, client =>
      client.query<{
        version_id: string
        revision: string
        shell_revision: string
      }>('SELECT * FROM app.publish_theme($1,$2)', [s.siteA, privateHead.revision]),
    )
    const liveHead = await themeHead()
    expect(liveHead.draft_version_id).toBe(published.rows[0]!.version_id)
    expect(liveHead.published_version_id).toBe(published.rows[0]!.version_id)
    expect(liveHead.published).toEqual(TOKENS)
    expect(Number(published.rows[0]!.revision)).toBe(Number(privateHead.revision) + 1)

    const versions = await db.asUser(s.editorA, client =>
      client.query<{
        id: string
        tokens: unknown
      }>('SELECT id, tokens FROM theme_versions WHERE theme_id = $1 ORDER BY revision', [liveHead.id]),
    )
    expect(versions.rows.map(row => row.id)).toContain(saved.rows[0]!.version_id)
    expect(versions.rows.find(row => row.id === before.published_version_id)!.tokens).toEqual(before.published)

    const evidence = await db.as('owner', async client => ({
      shell: (
        await client.query<{ tokens: unknown }>(
          "SELECT payload->'theme' AS tokens FROM published_site_shells WHERE site_id = $1",
          [s.siteA],
        )
      ).rows[0]!,
      audit: (
        await client.query<{ action: string }>(
          "SELECT action FROM audit_log WHERE site_id = $1 AND action IN ('theme.save','theme.publish') ORDER BY created_at",
          [s.siteA],
        )
      ).rows,
      outbox: (
        await client.query<{ payload: { paths: string[] } }>(
          "SELECT payload FROM outbox WHERE site_id = $1 AND event_type = 'site_shell.published' ORDER BY created_at DESC LIMIT 1",
          [s.siteA],
        )
      ).rows[0]!,
    }))
    expect(evidence.shell.tokens).toEqual(TOKENS)
    expect(evidence.audit.map(row => row.action)).toEqual(['theme.save', 'theme.publish'])
    expect(evidence.outbox.payload.paths).toEqual(['/'])
  })

  it('uses strict compare-and-set revisions', async () => {
    const head = await themeHead()
    await expectSqlState(save(TOKENS, Number(head.revision) - 1), 'CMS01')
    expect((await themeHead()).revision).toBe(head.revision)
  })

  it('denies contributors, same-site editors, and editors from another tenant', async () => {
    const head = await themeHead()
    await expectSqlState(
      db.asUser(s.contributorA, client =>
        client.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteA, head.revision, JSON.stringify(TOKENS)]),
      ),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.editorB, client => client.query('SELECT * FROM app.publish_theme($1,$2)', [s.siteA, head.revision])),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(sameSiteEditor, client =>
        client.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteA, head.revision, JSON.stringify(TOKENS)]),
      ),
      'CMS02',
    )
  })

  it('reverts to live by creating a new draft instead of moving history backwards', async () => {
    const before = await themeHead()
    const changed = { ...TOKENS, colors: { ...TOKENS.colors, accent: '#9b1c31' } }
    await save(changed, Number(before.revision))
    const privateHead = await themeHead()
    expect(privateHead.draft).toEqual(changed)
    expect(privateHead.published).toEqual(TOKENS)

    const reverted = await db.asUser(s.editorA, client =>
      client.query<{
        version_id: string
        revision: string
      }>('SELECT * FROM app.revert_theme_to_live($1,$2)', [s.siteA, privateHead.revision]),
    )
    const after = await themeHead()
    expect(after.draft).toEqual(TOKENS)
    expect(after.published).toEqual(TOKENS)
    expect(after.draft_version_id).toBe(reverted.rows[0]!.version_id)
    expect(after.draft_version_id).not.toBe(after.published_version_id)
    const audit = await db.asUser(s.editorA, client =>
      client.query("SELECT id FROM audit_log WHERE site_id = $1 AND action = 'theme.revert_to_live'", [s.siteA]),
    )
    expect(audit.rows).toHaveLength(1)
  })

  it.each([
    ['a scalar', 'nope'],
    ['an unknown top-level property', { ...TOKENS, customCss: 'body{}' }],
    ['an unknown color role', { ...TOKENS, colors: { ...TOKENS.colors, danger: '#ff0000' } }],
    ['an arbitrary font stack', { ...TOKENS, fonts: { ...TOKENS.fonts, body: 'url(https://evil.test/font)' } }],
    ['a shorthand color', { ...TOKENS, colors: { ...TOKENS.colors, accent: '#fff' } }],
    ['a null color', { ...TOKENS, colors: { ...TOKENS.colors, accent: null } }],
    ['an unknown button setting', { ...TOKENS, buttons: { ...TOKENS.buttons, shadow: 'huge' } }],
    ['an unbounded font value', { ...TOKENS, fonts: { ...TOKENS.fonts, body: 'x'.repeat(140_000) } }],
  ])('refuses %s at the database boundary', async (_label, tokens) => {
    await expectSqlState(save(tokens), 'CMS04')
  })

  it.each([
    ['body text', { ...TOKENS.colors, ink: '#777777', surface: '#ffffff' }],
    ['primary button', { ...TOKENS.colors, primary: '#777777', primaryContrast: '#ffffff' }],
    ['accent button', { ...TOKENS.colors, accent: '#777777', accentContrast: '#ffffff' }],
  ])('refuses insufficient %s contrast at publication', async (_label, colors) => {
    const result = await save({ ...TOKENS, colors })
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.publish_theme($1,$2)', [s.siteA, result.rows[0]!.revision]),
      ),
      'CMS04',
    )
    const head = await themeHead()
    expect(head.published).toEqual(TOKENS)
  })
})

it('saves approved self-hosted pairings privately without weakening font validation or history', async () => {
  const before = await themeHead(),
    tokens = {
      ...TOKENS,
      fonts: { heading: "'Source Serif 4', Georgia, serif", body: "'Open Sans', Arial, sans-serif" },
    }
  const saved = await save(tokens, Number(before.revision)),
    after = await themeHead()
  expect(after.draft).toEqual(tokens)
  expect(after.published).toEqual(before.published)
  expect(after.published_version_id).toBe(before.published_version_id)
  expect(after.draft_version_id).toBe(saved.rows[0]!.version_id)
  const previous = await db.asUser(s.editorA, client =>
    client.query('SELECT tokens FROM theme_versions WHERE id=$1', [before.draft_version_id]),
  )
  expect(previous.rows[0]!.tokens).toEqual(before.draft)
  await expectSqlState(save({ ...tokens, fonts: { ...tokens.fonts, heading: "'Unapproved Serif', serif" } }), 'CMS04')
  await expectSqlState(save(tokens, Number(before.revision)), 'CMS01')
})

it('reapplies the fixed font allowlist without changing function authority or saved site content', async () => {
  const sql = await readFile(new URL('../migrations/0129_self_hosted_source_serif.sql', import.meta.url), 'utf8'),
    before = await themeHead()
  await db.as('owner', async client => {
    const authority = () =>
      client.query(
        "SELECT proowner::regrole::text AS owner,proacl::text AS grants FROM pg_proc WHERE oid='app.theme_tokens_defect(jsonb)'::regprocedure",
      )
    const initial = (await authority()).rows
    await client.query(sql)
    await client.query(sql)
    expect((await authority()).rows).toEqual(initial)
    const fonts = {
      ...TOKENS,
      fonts: { heading: "'Source Serif 4', Georgia, serif", body: "'Open Sans', Arial, sans-serif" },
    }
    expect(
      (await client.query('SELECT app.theme_tokens_defect($1) AS defect', [JSON.stringify(fonts)])).rows[0]!.defect,
    ).toBeNull()
  })
  expect(await themeHead()).toEqual(before)
})

it('reapplies the bounded national presentation without changing authority, history or existing live themes', async () => {
  const sql = await readFile(new URL('../migrations/0144_national_panel_theme.sql', import.meta.url), 'utf8'),
    before = await themeHead()
  await db.as('owner', async client => {
    const authority = () =>
      client.query(
        "SELECT proowner::regrole::text AS owner,proacl::text AS grants FROM pg_proc WHERE oid='app.theme_tokens_defect(jsonb)'::regprocedure",
      )
    const initial = (await authority()).rows
    await client.query(sql)
    await client.query(sql)
    expect((await authority()).rows).toEqual(initial)
  })
  expect(await themeHead()).toEqual(before)
  const tokens = { ...TOKENS, radius: '1.25rem', presentation: { kind: 'panels', canvas: '#d9d9d9' } },
    saved = await save(tokens, Number(before.revision)),
    after = await themeHead()
  expect(after.draft).toEqual(tokens)
  expect(after.published).toEqual(before.published)
  expect(after.draft_version_id).toBe(saved.rows[0]!.version_id)
  for (const presentation of [
    null,
    { kind: 'arbitrary', canvas: '#d9d9d9' },
    { kind: 'panels', canvas: 'red' },
    { kind: 'panels', canvas: '#d9d9d9', css: 'body{}' },
  ])
    await expectSqlState(save({ ...tokens, presentation }), 'CMS04')
  await expectSqlState(save(tokens, Number(before.revision)), 'CMS01')
  await expectSqlState(
    db.asUser(s.editorB, client =>
      client.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteA, after.revision, JSON.stringify(tokens)]),
    ),
    'CMS02',
  )
  expect(await themeHead()).toEqual(after)
})

it('allows the approved local Creato stack without changing live themes or command authority', async () => {
  const sql = await readFile(new URL('../migrations/0146_local_creato_theme.sql', import.meta.url), 'utf8'),
    before = await themeHead()
  await db.as('owner', async c => {
    const authority = () =>
      c.query(
        "SELECT proowner::regrole::text,proacl::text FROM pg_proc WHERE oid='app.theme_tokens_defect(jsonb)'::regprocedure",
      )
    const original = (await authority()).rows
    await c.query(sql)
    await c.query(sql)
    expect((await authority()).rows).toEqual(original)
  })
  expect(await themeHead()).toEqual(before)
  const font = "'Creato Display', 'Open Sans', Arial, sans-serif"
  await save({ ...TOKENS, fonts: { heading: font, body: font } }, Number(before.revision))
  const after = await themeHead()
  expect(after.draft.fonts).toEqual({ heading: font, body: font })
  expect(after.published).toEqual(before.published)
})

it('saves bounded small-caps panel headings without changing published themes or permissions', async () => {
  const sql = await readFile(new URL('../migrations/0155_panel_heading_style.sql', import.meta.url), 'utf8')
  await db.as('owner', async c => {
    await c.query(sql)
    await c.query(sql)
  })
  const before = await themeHead(),
    tokens = { ...TOKENS, presentation: { kind: 'panels', canvas: '#d9d9d9', headings: 'small-caps' } }
  await save(tokens, Number(before.revision))
  const after = await themeHead()
  expect(after.draft).toEqual(tokens)
  expect(after.published).toEqual(before.published)
  for (const headings of [null, 'uppercase', 'small-caps;body{}'])
    await expectSqlState(
      save({ ...tokens, presentation: { ...tokens.presentation, headings } }, Number(after.revision)),
      'CMS04',
    )
  await expectSqlState(
    db.asUser(s.editorB, c =>
      c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteA, after.revision, JSON.stringify(tokens)]),
    ),
    'CMS02',
  )
})
