// Readiness parity: the same policy, the same verdict, on every publish path.
//
// SPEC §6.8 says the readiness policy runs for editor, review, bulk and
// scheduled publication, and that the same invalid draft is refused everywhere.
// It was not true. execute_scheduled_action sent a hard-coded policy version 1
// and an empty '{}' report, and the worker never ran the checks at all — so a
// version the editor refused for having no main heading, no sections, an image
// with no description, or a link to a page that does not exist went live the
// moment its timer fired. The editor was the only thing enforcing the policy,
// and the scheduler is not the editor.
//
// Everything here is written against the real worker role and the real
// scheduler entry point, because the claim being tested is about two different
// processes reaching the same conclusion, which no unit test can establish.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION } from '@cms/renderer'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { evaluateVersionReadiness } from '@cms/platform'
import { runDueSchedules } from '../src/handlers.ts'
import { READINESS_POLICY_VERSION } from '@cms/domain'

let db: TestDatabase
let s: Scenario
/** A section that renders real content and no <h1> — blocking under policy 1. */
let headlessDefId: string
/** A section with a heading and one link, for internal-link checking. */
let linkingDefId: string

beforeAll(async () => {
  db = await TestDatabase.create('readiness')
  s = await seedScenario(db)
  headlessDefId = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ section_def_id: string }>(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            'plain',
            'Plain',
            'Text',
            '<section class="plain"><p>{{text}}</p></section>',
            '.plain{padding:1rem}',
            '.cms-section--plain .plain{padding:1rem}',
            JSON.stringify({
              nodes: [
                { kind: 'html', value: '<section class="plain"><p>' },
                { kind: 'slot', slotId: 'text', slotKind: 'text', context: 'element-text' },
                { kind: 'html', value: '</p></section>' },
              ],
              policyVersion: 4,
              cssPolicyVersion: 6,
            }),
            JSON.stringify([{ id: 'text', kind: 'text', label: 'Text', constraints: {} }]),
            'hash-plain-1',
            SANITIZER_POLICY_VERSION,
            CSS_POLICY_VERSION,
            'initial',
          ],
        )
      ).rows[0]!.section_def_id,
  )

  linkingDefId = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ section_def_id: string }>(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            'linking',
            'Linking',
            'Text',
            '<section class="linking"><h1>{{heading}}</h1><p>{{cta}}</p></section>',
            '.linking{padding:1rem}',
            '.cms-section--linking .linking{padding:1rem}',
            JSON.stringify({
              nodes: [
                { kind: 'html', value: '<section class="linking"><h1>' },
                { kind: 'slot', slotId: 'heading', slotKind: 'text', context: 'element-text' },
                { kind: 'html', value: '</h1><p>' },
                { kind: 'slot', slotId: 'cta', slotKind: 'link', context: 'element-text' },
                { kind: 'html', value: '</p></section>' },
              ],
              policyVersion: 4,
              cssPolicyVersion: 6,
            }),
            JSON.stringify([
              { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
              { id: 'cta', kind: 'link', label: 'Call to action', constraints: {} },
            ]),
            'hash-linking-1',
            SANITIZER_POLICY_VERSION,
            CSS_POLICY_VERSION,
            'initial',
          ],
        )
      ).rows[0]!.section_def_id,
  )

  // Global chrome participates in readiness. The default header's brand link
  // points to `/`, so make the seeded home page genuinely live before testing
  // whether page-body links are valid or whether a schedule can publish.
  const homeVersion = await saveDraft(s.pageA, heroContent(s.heroDefId, 'Home'))
  const homeReport = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, homeVersion, 'member'))
  const homeRevision = await revisionOf(s.pageA)
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
      s.pageA,
      homeRevision,
      homeReport.policyVersion,
      null,
      JSON.stringify(homeReport.findings),
    ]),
  )
})
afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.as('owner', c => c.query('DELETE FROM scheduled_actions'))
  await db.as('owner', c => c.query('DELETE FROM outbox'))
})

const headlessContent = (text = 'Body copy with no heading above it.') =>
  JSON.stringify([
    {
      section_def_id: headlessDefId,
      section_def_version: 1,
      values: { text },
      hidden: false,
      hidden_at: [],
      label: 'Plain',
    },
  ])

const linkingContent = (url: string) =>
  JSON.stringify([
    {
      section_def_id: linkingDefId,
      section_def_version: 1,
      values: { heading: 'A heading', cta: { url, label: 'Go' } },
      hidden: false,
      hidden_at: [],
      label: 'Linking',
    },
  ])

async function newPage(slug: string): Promise<string> {
  return db.asUser(
    s.editorA,
    async c =>
      (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, slug])).rows[0]!.id,
  )
}

async function revisionOf(pageId: string): Promise<number> {
  return db.as('owner', async c =>
    Number(
      (await c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [pageId])).rows[0]!.revision,
    ),
  )
}

async function saveDraft(pageId: string, content: string): Promise<string> {
  const rev = await revisionOf(pageId)
  return db.asUser(
    s.editorA,
    async c =>
      (
        await c.query<{ version_id: string }>('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4)', [
          pageId,
          rev,
          content,
          '{}',
        ])
      ).rows[0]!.version_id,
  )
}

// The policy version a test schedule pins is READINESS_POLICY_VERSION, not a
// literal. Hard-coding it asserted a constant rather than a behaviour, so the
// whole file went red the first time the policy was bumped — and the migration
// that carries live pins forward cannot help, because these rows are created
// after it runs.
async function schedule(pageId: string, versionId: string, policyVersion = READINESS_POLICY_VERSION): Promise<string> {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO scheduled_actions (site_id, item_type, item_id, version_id, action, run_at,
                                      created_by, readiness_policy_version)
       VALUES ($1,'page',$2,$3,'publish', now() - interval '1 second', $4, $5) RETURNING id`,
          [s.siteA, pageId, versionId, s.editorA, policyVersion],
        )
      ).rows[0]!.id,
  )
}

type ScheduleRow = {
  status: string
  failure_kind: string | null
  last_error: string | null
  readiness_policy_version: number
  readiness_report: { rule: string; severity: string }[] | null
}
async function scheduleRow(id: string): Promise<ScheduleRow> {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<ScheduleRow>(
          `SELECT status, failure_kind, last_error, readiness_policy_version, readiness_report
         FROM scheduled_actions WHERE id = $1`,
          [id],
        )
      ).rows[0]!,
  )
}

describe('a version the editor refuses is refused by the scheduler too', () => {
  it('both roles reach the same verdict about the same version', async () => {
    const page = await newPage('parity-verdict')
    const version = await saveDraft(page, headlessContent())

    // The editor's evaluation, through the member-scoped manifest function...
    const asEditor = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, version, 'member'))
    // ...and the worker's, through the internal one. Same module, same policy.
    const asWorker = await db.asWorker('w1', c => evaluateVersionReadiness(c, version, 'worker'))

    expect(asEditor.ok).toBe(false)
    expect(asEditor.blocking.map(f => f.rule)).toContain('missing_h1')
    expect(asWorker.blocking.map(f => f.rule)).toEqual(asEditor.blocking.map(f => f.rule))
    expect(asWorker.policyVersion).toBe(asEditor.policyVersion)
  })

  it('the editor cannot publish it', async () => {
    const page = await newPage('parity-editor')
    const version = await saveDraft(page, headlessContent())
    const report = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, version, 'member'))
    const rev = await revisionOf(page)

    // The database refuses it, not merely the server action. Passing the real
    // report with no override reason is exactly what the editor does when
    // someone presses Publish without acknowledging the problems.
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
          page,
          rev,
          report.policyVersion,
          null,
          JSON.stringify(report.findings),
        ]),
      ),
      'CMS04',
    )

    expect(await revisionOf(page)).toBe(rev)
    void version
  })

  it('the scheduler does not publish it either, and says why', async () => {
    const page = await newPage('parity-schedule')
    const version = await saveDraft(page, headlessContent())
    const revBefore = await revisionOf(page)
    const id = await schedule(page, version)

    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.blocked).toBe(1)
    expect(summary.ran).toBe(0)

    // Nothing moved: not the head, not the projection, not the audit, not the
    // queue. A publication that did not happen leaves no half of itself behind.
    expect(await revisionOf(page)).toBe(revBefore)
    const head = await db.as('owner', c =>
      c.query<{ v: string | null }>('SELECT published_version_id AS v FROM pages WHERE id = $1', [page]),
    )
    expect(head.rows[0]!.v).toBeNull()

    const route = await db.as('owner', c =>
      c.query('SELECT path FROM published_routes WHERE site_id = $1 AND path = $2', [s.siteA, '/parity-schedule']),
    )
    expect(route.rows).toHaveLength(0)

    const audit = await db.as('owner', c =>
      c.query("SELECT id FROM audit_log WHERE action = 'page.publish' AND item_id = $1", [page]),
    )
    expect(audit.rows).toHaveLength(0)

    const events = await db.as('owner', c =>
      c.query("SELECT id FROM outbox WHERE payload->>'path' = '/parity-schedule'"),
    )
    expect(events.rows).toHaveLength(0)

    // And the refusal is actionable rather than a shrug.
    const row = await scheduleRow(id)
    expect(row.status).toBe('failed')
    expect(row.failure_kind).toBe('readiness')
    expect(row.last_error).toContain('missing_h1')
    expect(row.readiness_policy_version).toBe(READINESS_POLICY_VERSION)
    expect(row.readiness_report!.map(f => f.rule)).toContain('missing_h1')
    void version
  })

  it('records the refusal in the audit, as the scheduler', async () => {
    const page = await newPage('parity-audit')
    const version = await saveDraft(page, headlessContent())
    const id = await schedule(page, version)
    await runDueSchedules(db.pool('worker'), 'w1')

    const { rows } = await db.as('owner', c =>
      c.query<{ actor_type: string; actor_id: string | null; detail: Record<string, unknown> }>(
        "SELECT actor_type, actor_id, detail FROM audit_log WHERE action = 'schedule.blocked' AND item_id = $1",
        [id],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.actor_type).toBe('scheduler')
    expect(rows[0]!.actor_id).toBeNull()
    expect(rows[0]!.detail['blocking']).toContain('missing_h1')
    expect(rows[0]!.detail['readiness_policy_version']).toBe(READINESS_POLICY_VERSION)
    expect(rows[0]!.detail['authorized_by']).toBe(s.editorA)
  })

  it('does not retry a blocked schedule — the content is immutable', async () => {
    const page = await newPage('parity-noretry')
    const version = await saveDraft(page, headlessContent())
    const id = await schedule(page, version)

    await runDueSchedules(db.pool('worker'), 'w1')
    const second = await runDueSchedules(db.pool('worker'), 'w1')
    expect(second.blocked).toBe(0)
    expect(second.ran).toBe(0)
    expect((await scheduleRow(id)).status).toBe('failed')
  })

  it('an empty page is refused as well, not treated as trivially fine', async () => {
    const page = await newPage('parity-empty')
    const version = await saveDraft(page, '[]')
    const id = await schedule(page, version)

    expect((await runDueSchedules(db.pool('worker'), 'w1')).blocked).toBe(1)
    expect((await scheduleRow(id)).last_error).toContain('empty_page')
  })
})

describe('internal links are judged against what will exist, not only what does', () => {
  it('a page that links to itself is not refused for linking to itself', async () => {
    // published_routes is what is live *now*, and this version is being judged
    // for going live. Before this was handled, a site's first page whose call to
    // action pointed at `/` was refused for linking to a page that does not
    // exist — naming itself. Found by making the seed publish through the
    // shared evaluator: the demo home page links to `/` and is `/`.
    const page = await newPage('self-link')
    const version = await saveDraft(page, linkingContent('/self-link'))

    const report = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, version, 'member'))
    expect(report.blocking.map(f => f.rule)).not.toContain('broken_internal_link')
    expect(report.ok).toBe(true)

    const id = await schedule(page, version)
    expect((await runDueSchedules(db.pool('worker'), 'w1')).ran).toBe(1)
    expect((await scheduleRow(id)).status).toBe('succeeded')
  })

  it('a link to a page that really does not exist is still refused', async () => {
    const page = await newPage('dangling-link')
    const version = await saveDraft(page, linkingContent('/no-such-page'))

    const report = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, version, 'member'))
    expect(report.blocking.map(f => f.rule)).toContain('broken_internal_link')

    const id = await schedule(page, version)
    expect((await runDueSchedules(db.pool('worker'), 'w1')).blocked).toBe(1)
    expect((await scheduleRow(id)).last_error).toContain('broken_internal_link')
  })

  it('a link to another page that is already published is fine', async () => {
    const target = await newPage('already-live')
    const targetVersion = await saveDraft(target, heroContent(s.heroDefId, 'Target'))
    await schedule(target, targetVersion)
    expect((await runDueSchedules(db.pool('worker'), 'w1')).ran).toBe(1)

    const page = await newPage('links-out')
    const version = await saveDraft(page, linkingContent('/already-live'))
    const report = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, version, 'member'))
    expect(report.ok).toBe(true)
  })
})

describe('a ready version still publishes', () => {
  it('publishes, and records the report it was judged by', async () => {
    const page = await newPage('parity-ready')
    const version = await saveDraft(page, heroContent(s.heroDefId, 'A proper heading'))
    const id = await schedule(page, version)

    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.ran).toBe(1)
    expect(summary.blocked).toBe(0)

    const head = await db.as('owner', c =>
      c.query<{ v: string }>('SELECT published_version_id AS v FROM pages WHERE id = $1', [page]),
    )
    expect(head.rows[0]!.v).toBe(version)

    const row = await scheduleRow(id)
    expect(row.status).toBe('succeeded')
    // The advisory finding is kept: "we checked and this is what we saw" is the
    // durable claim, not just "it passed".
    expect(row.readiness_report).not.toBeNull()
    expect(row.readiness_report!.every(f => f.severity !== 'blocking')).toBe(true)
  })

  it('the publication audit carries the policy version and the report', async () => {
    const page = await newPage('parity-ready-audit')
    const version = await saveDraft(page, heroContent(s.heroDefId, 'Another heading'))
    await schedule(page, version)
    await runDueSchedules(db.pool('worker'), 'w1')

    const { rows } = await db.as('owner', c =>
      c.query<{ detail: Record<string, unknown> }>(
        "SELECT detail FROM audit_log WHERE action = 'page.publish' AND item_id = $1",
        [page],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.detail['readiness_policy_version']).toBe(READINESS_POLICY_VERSION)
    expect(Array.isArray(rows[0]!.detail['readiness'])).toBe(true)
  })
})

/*
 * What follows tests the boundary precisely, and it is worth stating what that
 * boundary is, because it is easy to overclaim.
 *
 * The database CAN prove: a report was explicitly supplied; its policy version
 * and structure are valid; declared blocking findings require an override
 * reason; and the invariants that never depend on a report at all —
 * authorization, the pinned version's ownership, trusted-code approval, the
 * revision CAS, audit, the public projection, atomicity — hold whatever any
 * report says.
 *
 * The database CANNOT prove that the findings it was handed are the ones the
 * TypeScript evaluator would produce for that version. Rendering a page is not
 * something SQL does. The boundary is placed elsewhere instead: the trusted
 * admin server, the worker, and the seed all compute the report with the shared
 * module in @cms/platform, and the browser never holds a database credential
 * and never supplies a report. So the guarantee is "every supported publication
 * surface runs the shared evaluator, and the database refuses anything that
 * surface could not have produced" — not "the database recomputed it".
 */
describe('the report must be supplied, and must be shaped like a report', () => {
  async function claimed(id: string): Promise<string> {
    const { rows } = await db.asWorker('w1', c =>
      c.query<{ lease_token: string }>('SELECT lease_token FROM app.claim_scheduled_action($1)', [60]),
    )
    void id
    return rows[0]!.lease_token
  }

  it('refuses the empty object that used to be passed', async () => {
    const page = await newPage('gate-empty-object')
    const version = await saveDraft(page, headlessContent())
    const id = await schedule(page, version)
    const token = await claimed(id)

    // This is verbatim what 0009 sent. '{}' is not a findings list; it is the
    // shape you get when nobody ran the checks.
    await expectSqlState(
      db.asWorker('w1', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [id, token, READINESS_POLICY_VERSION, '{}']),
      ),
      'CMS04',
    )
    expect(await revisionOf(page)).toBe(1)
  })

  it('refuses a missing report', async () => {
    const page = await newPage('gate-null')
    const version = await saveDraft(page, heroContent(s.heroDefId, 'Fine'))
    const id = await schedule(page, version)
    const token = await claimed(id)

    await expectSqlState(
      db.asWorker('w1', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [id, token, READINESS_POLICY_VERSION, null]),
      ),
      'CMS04',
    )
  })

  it('refuses a report produced under a different policy version', async () => {
    const page = await newPage('gate-policy')
    const version = await saveDraft(page, heroContent(s.heroDefId, 'Fine'))
    // A schedule written against a policy this worker does not implement. The
    // version is expressed relative to the current one, not as a literal: it
    // used to say 2, and the day the policy became 2 this stopped testing a
    // mismatch at all and started testing agreement.
    const id = await schedule(page, version, READINESS_POLICY_VERSION + 1)
    const token = await claimed(id)

    // Judging it by the wrong rules is worse than refusing: the person who
    // scheduled it expected the newer policy's guarantees.
    await expectSqlState(
      db.asWorker('w1', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [id, token, READINESS_POLICY_VERSION, '[]']),
      ),
      'CMS04',
    )
    expect(await revisionOf(page)).toBe(1)
  })

  it.each([
    ['an empty object', '{}'],
    ['a bare number', '1'],
    ['a string', '"clean"'],
    ['an element that is not an object', '[1]'],
    ['an element that is a string', '["missing_h1"]'],
    ['a finding with no rule', '[{"severity":"advisory","message":"m"}]'],
    ['a finding with a blank rule', '[{"rule":"  ","severity":"advisory","message":"m"}]'],
    ['a finding with an unknown severity', '[{"rule":"r","severity":"warn","message":"m"}]'],
    ['a finding with a numeric severity', '[{"rule":"r","severity":2,"message":"m"}]'],
    ['a finding with no message', '[{"rule":"r","severity":"blocking"}]'],
    ['a finding with a blank message', '[{"rule":"r","severity":"blocking","message":" "}]'],
    ['an empty finding', '[{}]'],
    ['one good finding and one malformed', '[{"rule":"a","severity":"advisory","message":"m"},{}]'],
  ])('the scheduler refuses %s', async (label, report) => {
    const page = await newPage(`gate-shape-${label.replace(/[^a-z]+/gi, '-')}`)
    const version = await saveDraft(page, heroContent(s.heroDefId, 'Fine'))
    const id = await schedule(page, version)
    const token = await claimed(id)

    // A malformed array is worse than a missing report: nothing in it is a
    // blocking finding, because nothing in it is a finding at all, so it reads
    // as clean to anyone only counting severities.
    await expectSqlState(
      db.asWorker('w1', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [id, token, READINESS_POLICY_VERSION, report]),
      ),
      'CMS04',
    )
    expect(await revisionOf(page)).toBe(1)
  })

  it.each([
    ['an element that is not an object', '[1]'],
    ['a finding with an unknown severity', '[{"rule":"r","severity":"warn","message":"m"}]'],
    ['an empty finding', '[{}]'],
  ])('the editor refuses %s too — one validator, both paths', async (label, report) => {
    const page = await newPage(`gate-editor-${label.replace(/[^a-z]+/gi, '-')}`)
    await saveDraft(page, heroContent(s.heroDefId, 'Fine'))
    const rev = await revisionOf(page)

    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, rev, READINESS_POLICY_VERSION, null, report]),
      ),
      'CMS04',
    )
    expect(await revisionOf(page)).toBe(rev)
  })

  it('names the offending finding by position, so the message is actionable', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ defect: string | null }>('SELECT app.readiness_defect($1) AS defect', [
        '[{"rule":"a","severity":"advisory","message":"m"},{"rule":"b","severity":"nope","message":"m"}]',
      ]),
    )
    expect(rows[0]!.defect).toBe("finding 1 has severity 'nope', which is neither blocking nor advisory")
  })

  it('accepts a well-formed report with both severities', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ defect: string | null }>('SELECT app.readiness_defect($1) AS defect', [
        '[{"rule":"missing_h1","severity":"blocking","message":"No heading."},' +
          '{"rule":"missing_meta_description","severity":"advisory","message":"No description."}]',
      ]),
    )
    expect(rows[0]!.defect).toBeNull()
  })

  it('refuses blocking findings from any caller, override or not', async () => {
    const page = await newPage('gate-blocking')
    const version = await saveDraft(page, heroContent(s.heroDefId, 'Fine'))
    const id = await schedule(page, version)
    const token = await claimed(id)

    // A worker that renders nothing and reports a blocking finding anyway is
    // still refused — the gate is the report's contents, not who sent it.
    const blocked = JSON.stringify([{ rule: 'image_without_alt', severity: 'blocking', message: 'x' }])
    const outcome = await db.asWorker('w1', c =>
      c.query<{ outcome: string }>('SELECT outcome FROM app.execute_scheduled_action($1,$2,$3,$4)', [
        id,
        token,
        READINESS_POLICY_VERSION,
        blocked,
      ]),
    )
    expect(outcome.rows[0]!.outcome).toBe('blocked')
    expect(await revisionOf(page)).toBe(1)
  })

  it('the editor cannot override with a blank reason', async () => {
    const page = await newPage('gate-blank-override')
    const version = await saveDraft(page, headlessContent())
    const report = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, version, 'member'))
    const rev = await revisionOf(page)

    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
          page,
          rev,
          READINESS_POLICY_VERSION,
          '   ',
          JSON.stringify(report.findings),
        ]),
      ),
      'CMS04',
    )
  })

  it('an override with a real reason publishes, and the audit names what it waived', async () => {
    const page = await newPage('gate-override')
    const version = await saveDraft(page, headlessContent())
    const report = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, version, 'member'))
    const rev = await revisionOf(page)

    await db.asUser(s.editorA, c =>
      c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
        page,
        rev,
        READINESS_POLICY_VERSION,
        'Heading is in the hero image for the campaign',
        JSON.stringify(report.findings),
      ]),
    )

    const { rows } = await db.as('owner', c =>
      c.query<{ detail: Record<string, unknown> }>(
        "SELECT detail FROM audit_log WHERE action = 'page.publish' AND item_id = $1",
        [page],
      ),
    )
    expect(rows[0]!.detail['override_reason']).toContain('campaign')
    expect(rows[0]!.detail['overridden_blocking']).toContain('missing_h1')
    void version
  })
})
