// Page review is a publication path, not a decorative workflow table. These
// tests run as the real application role so permission, RLS, CAS, audit, and
// publication either hold together or fail together (SPEC §6.12).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let serial = 0

beforeAll(async () => {
  db = await TestDatabase.create('review')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

async function createDraft(author = s.editorA, editor = s.editorA, heading = 'Review me') {
  const slug = `review-${++serial}`
  const pageId = await db.asUser(
    editor,
    async client =>
      (
        await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          slug,
          `Review ${serial}`,
        ])
      ).rows[0]!.id,
  )
  const saved = await db.asUser(author, client =>
    client.query<{
      version_id: string
      revision: string
    }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [pageId, 0, heroContent(s.heroDefId, heading), '{}']),
  )
  return { pageId, versionId: saved.rows[0]!.version_id, revision: Number(saved.rows[0]!.revision) }
}

async function submit(author: string, pageId: string, revision: number, note = 'Please review this.') {
  return db.asUser(author, client =>
    client.query<{
      submission_id: string
      version_id: string
      revision: string
    }>('SELECT * FROM app.submit_page_for_review($1,$2,$3)', [pageId, revision, note]),
  )
}

describe('submitting an immutable page version', () => {
  it('lets a contributor submit, creates a permanent submission version, and audits it', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision, 'Homepage copy is ready.')
    const row = opened.rows[0]!
    expect(Number(row.revision)).toBe(draft.revision + 1)
    expect(row.version_id).not.toBe(draft.versionId)

    const evidence = await db.asUser(s.contributorA, client =>
      client.query<{
        status: string
        kind: string
        note: string
        current: boolean
      }>(
        `SELECT s.status, pv.kind, s.note, p.draft_version_id = s.version_id AS current
         FROM submissions s
         JOIN page_versions pv ON pv.id = s.version_id
         JOIN pages p ON p.id = s.item_id
        WHERE s.id = $1`,
        [row.submission_id],
      ),
    )
    expect(evidence.rows[0]).toMatchObject({
      status: 'open',
      kind: 'submission',
      note: 'Homepage copy is ready.',
      current: true,
    })

    const audit = await db.asUser(s.editorA, client =>
      client.query(
        `SELECT id FROM audit_log
        WHERE action = 'submission.opened' AND item_id = $1`,
        [row.submission_id],
      ),
    )
    expect(audit.rows).toHaveLength(1)
  })

  it('is actor-bound and idempotent when the byte-for-byte request is retried', async () => {
    const draft = await createDraft(s.contributorA)
    const note = 'The response may be lost, but this request is stable.'
    const first = await submit(s.contributorA, draft.pageId, draft.revision, note)
    const second = await submit(s.contributorA, draft.pageId, draft.revision, note)
    expect(second.rows[0]!.submission_id).toBe(first.rows[0]!.submission_id)
    expect(second.rows[0]!.version_id).toBe(first.rows[0]!.version_id)

    await expectSqlState(submit(s.editorA, draft.pageId, draft.revision, note), 'CMS01')

    const count = await db.asUser(s.editorA, client =>
      client.query<{ n: string }>(`SELECT count(*) AS n FROM submissions WHERE item_id = $1`, [draft.pageId]),
    )
    expect(Number(count.rows[0]!.n)).toBe(1)
  })

  it('supersedes the open request as soon as a newer draft becomes current', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    const submittedRevision = Number(opened.rows[0]!.revision)

    await db.asUser(s.contributorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        draft.pageId,
        submittedRevision,
        heroContent(s.heroDefId, 'Changed after submit'),
        '{}',
      ]),
    )
    const state = await db.asUser(s.editorA, client =>
      client.query<{ status: string }>('SELECT status FROM submissions WHERE id = $1', [opened.rows[0]!.submission_id]),
    )
    expect(state.rows[0]!.status).toBe('superseded')
  })

  it('refuses stale, cross-site, disabled, and no-draft submissions', async () => {
    const draft = await createDraft(s.contributorA)
    await expectSqlState(submit(s.contributorA, draft.pageId, 0), 'CMS01')
    await expectSqlState(submit(s.editorB, draft.pageId, draft.revision), 'CMS02')
    await expectSqlState(submit(s.disabled, draft.pageId, draft.revision), 'CMS02')

    const empty = await db.asUser(
      s.editorA,
      async client =>
        (
          await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteA,
            `review-${++serial}`,
            'Empty',
          ])
        ).rows[0]!.id,
    )
    await expectSqlState(submit(s.contributorA, empty, 0), 'CMS04')
  })

  it('shows contributors only their requests while reviewers see the whole site queue', async () => {
    const mine = await createDraft(s.contributorA)
    const theirs = await createDraft(s.editorA)
    await submit(s.contributorA, mine.pageId, mine.revision)
    await submit(s.editorA, theirs.pageId, theirs.revision)

    const contributor = await db.asUser(s.contributorA, client =>
      client.query<{ submitted_by: string }>('SELECT submitted_by FROM submissions WHERE item_id = ANY($1::uuid[])', [
        [mine.pageId, theirs.pageId],
      ]),
    )
    expect(contributor.rows.map(row => row.submitted_by)).toEqual([s.contributorA])

    const reviewer = await db.asUser(s.editorA, client =>
      client.query('SELECT id FROM submissions WHERE item_id = ANY($1::uuid[])', [[mine.pageId, theirs.pageId]]),
    )
    expect(reviewer.rows).toHaveLength(2)
  })
})

describe('deciding a submitted version', () => {
  it('lets an editor approve the exact version through the publication core', async () => {
    const draft = await createDraft(s.contributorA, s.editorA, 'Approved heading')
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    const id = opened.rows[0]!.submission_id

    const published = await db.asUser(s.editorA, client =>
      client.query<{
        published_version_id: string
        revision: string
        path: string
      }>('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [id, ...CHECKED_CLEAN]),
    )
    expect(published.rows[0]!.published_version_id).toBe(opened.rows[0]!.version_id)

    const state = await db.asUser(s.editorA, client =>
      client.query<{
        status: string
        decided_by: string
        published_version_id: string
      }>(
        `SELECT s.status, s.decided_by, p.published_version_id
         FROM submissions s JOIN pages p ON p.id = s.item_id WHERE s.id = $1`,
        [id],
      ),
    )
    expect(state.rows[0]).toMatchObject({
      status: 'approved',
      decided_by: s.editorA,
      published_version_id: opened.rows[0]!.version_id,
    })

    const audit = await db.asUser(s.editorA, client =>
      client.query<{ action: string }>(
        `SELECT action FROM audit_log
        WHERE item_id IN ($1,$2) AND action IN ('submission.approved','page.publish')
        ORDER BY action`,
        [id, draft.pageId],
      ),
    )
    expect(audit.rows.map(row => row.action).sort()).toEqual(['page.publish', 'submission.approved'])
  })

  it('refuses contributor approval at the command, not only in the interface', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    await expectSqlState(
      db.asUser(s.contributorA, client =>
        client.query('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [
          opened.rows[0]!.submission_id,
          ...CHECKED_CLEAN,
        ]),
      ),
      'CMS02',
    )
  })

  it('does not let direct Publish leave the exact reviewed version open', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [
          draft.pageId,
          Number(opened.rows[0]!.revision),
          ...CHECKED_CLEAN,
        ]),
      ),
      'CMS04',
    )
    const state = await db.asUser(s.editorA, client =>
      client.query<{
        status: string
        published_version_id: string | null
      }>(
        `SELECT s.status, p.published_version_id
         FROM submissions s JOIN pages p ON p.id = s.item_id WHERE s.id = $1`,
        [opened.rows[0]!.submission_id],
      ),
    )
    expect(state.rows[0]).toMatchObject({ status: 'open', published_version_id: null })
  })

  it('authorizes a page before inspecting whether its current version is under review', async () => {
    const waiting = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, waiting.pageId, waiting.revision)
    const ordinary = await createDraft(s.contributorA)

    const attempt = async (pageId: string, revision: number) => {
      try {
        await db.asUser(s.editorB, client =>
          client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [pageId, revision, ...CHECKED_CLEAN]),
        )
        return { code: 'succeeded', message: '' }
      } catch (error) {
        const failure = error as { code?: string; message?: string }
        return { code: failure.code ?? '', message: failure.message ?? '' }
      }
    }

    const withReview = await attempt(waiting.pageId, Number(opened.rows[0]!.revision))
    const withoutReview = await attempt(ordinary.pageId, ordinary.revision)
    expect(withReview).toEqual({
      code: 'CMS02',
      message: 'not permitted to publish on this site',
    })
    expect(withoutReview).toEqual(withReview)
  })

  it('requires super-admin review for a submitted raw-code version', async () => {
    const draft = await createDraft(s.contributorA)
    const content = JSON.parse(heroContent(s.heroDefId)) as Record<string, unknown>[]
    content[0]!['raw_html'] = '<p>Approved advanced markup</p>'
    const changed = await db.asUser(s.superAdmin, client =>
      client.query<{ revision: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        draft.pageId,
        draft.revision,
        JSON.stringify(content),
        '{}',
      ]),
    )
    const opened = await submit(s.contributorA, draft.pageId, Number(changed.rows[0]!.revision))

    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [
          opened.rows[0]!.submission_id,
          ...CHECKED_CLEAN,
        ]),
      ),
      'CMS05',
    )
    const approved = await db.asUser(s.superAdmin, client =>
      client.query('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [
        opened.rows[0]!.submission_id,
        ...CHECKED_CLEAN,
      ]),
    )
    expect(approved.rows).toHaveLength(1)
  })

  it('requires useful rejection feedback and leaves the live pointer alone', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    const id = opened.rows[0]!.submission_id
    await expectSqlState(
      db.asUser(s.editorA, client => client.query('SELECT app.reject_page_submission($1,$2)', [id, '   '])),
      'CMS04',
    )
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.reject_page_submission($1,$2)', [id, 'Use a clearer call to action.']),
    )
    const state = await db.asUser(s.contributorA, client =>
      client.query<{
        status: string
        decision_note: string
        published_version_id: string | null
      }>(
        `SELECT s.status, s.decision_note, p.published_version_id
         FROM submissions s JOIN pages p ON p.id = s.item_id WHERE s.id = $1`,
        [id],
      ),
    )
    expect(state.rows[0]).toMatchObject({
      status: 'rejected',
      decision_note: 'Use a clearer call to action.',
      published_version_id: null,
    })
  })

  it('serializes concurrent approvals so exactly one reviewer wins', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    const id = opened.rows[0]!.submission_id
    const calls = [s.editorA, s.superAdmin].map(user =>
      db.asUser(user, client =>
        client.query('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [id, ...CHECKED_CLEAN]),
      ),
    )
    const results = await Promise.allSettled(calls)
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)

    const publishes = await db.asUser(s.editorA, client =>
      client.query(`SELECT id FROM audit_log WHERE action = 'page.publish' AND item_id = $1`, [draft.pageId]),
    )
    expect(publishes.rows).toHaveLength(1)
  })
})

describe('review discussion', () => {
  it('stores a bounded page/version comment and derives its author', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    const comment = await db.asUser(s.editorA, client =>
      client.query<{ id: string }>('SELECT app.add_page_comment($1,$2,$3,$4) AS id', [
        draft.pageId,
        opened.rows[0]!.version_id,
        'Please tighten the opening sentence.',
        JSON.stringify([s.contributorA]),
      ]),
    )
    const row = await db.asUser(s.contributorA, client =>
      client.query<{
        author_id: string
        body: string
        mentions: string[]
      }>('SELECT author_id, body, mentions FROM comments WHERE id = $1', [comment.rows[0]!.id]),
    )
    expect(row.rows[0]).toMatchObject({
      author_id: s.editorA,
      body: 'Please tighten the opening sentence.',
      mentions: [s.contributorA],
    })
  })

  it('accepts a canonical UUID without imposing RFC version or variant nibbles', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    const comment = await db.asUser(s.editorA, client =>
      client.query<{ id: string }>('SELECT app.add_page_comment($1,$2,$3,$4) AS id', [
        draft.pageId,
        opened.rows[0]!.version_id,
        'Root should see this.',
        JSON.stringify([s.superAdmin]),
      ]),
    )
    const stored = await db.asUser(s.editorA, client =>
      client.query<{ mentions: string[] }>('SELECT mentions FROM comments WHERE id = $1', [comment.rows[0]!.id]),
    )
    expect(stored.rows[0]!.mentions).toEqual([s.superAdmin])
  })

  it('does not let a same-site contributor write into another contributor’s review', async () => {
    const otherContributor = await db.asUser(s.superAdmin, async client => {
      const user = await client.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [
        `other-contributor-${++serial}@example.test`,
        'Other Contributor',
      ])
      const id = user.rows[0]!.id
      await client.query('SELECT app.set_site_membership($1,$2,$3)', [id, s.siteA, 'contributor'])
      return id
    })
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)

    await expectSqlState(
      db.asUser(otherContributor, client =>
        client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [
          draft.pageId,
          opened.rows[0]!.version_id,
          'Planting a hidden comment',
          '[]',
        ]),
      ),
      'CMS03',
    )
  })

  it('refuses empty bodies, foreign versions, non-members, and direct writes', async () => {
    const draft = await createDraft(s.contributorA)
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [draft.pageId, draft.versionId, ' ', '[]']),
      ),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [draft.pageId, randomUUID(), 'Hello', '[]']),
      ),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [
          draft.pageId,
          draft.versionId,
          'Hello',
          JSON.stringify([s.editorB]),
        ]),
      ),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.contributorA, client =>
        client.query(
          `INSERT INTO comments (site_id,item_type,item_id,body,author_id)
         VALUES ($1,'page',$2,'forged',$3)`,
          [s.siteA, draft.pageId, s.contributorA],
        ),
      ),
      '42501',
    )
  })

  it('allows the author or a reviewer to resolve, and nobody else', async () => {
    const draft = await createDraft(s.contributorA)
    const opened = await submit(s.contributorA, draft.pageId, draft.revision)
    const comment = await db.asUser(s.contributorA, client =>
      client.query<{ id: string }>('SELECT app.add_page_comment($1,$2,$3,$4) AS id', [
        draft.pageId,
        opened.rows[0]!.version_id,
        'My own note',
        '[]',
      ]),
    )
    await expectSqlState(
      db.asUser(s.editorB, client => client.query('SELECT app.resolve_page_comment($1,true)', [comment.rows[0]!.id])),
      'CMS03',
    )
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.resolve_page_comment($1,true)', [comment.rows[0]!.id]),
    )
    const resolved = await db.asUser(s.contributorA, client =>
      client.query<{
        resolved_at: Date | null
        resolved_by: string | null
      }>('SELECT resolved_at, resolved_by FROM comments WHERE id = $1', [comment.rows[0]!.id]),
    )
    expect(resolved.rows[0]!.resolved_at).not.toBeNull()
    expect(resolved.rows[0]!.resolved_by).toBe(s.editorA)
  })

  it('does not leak another author’s review discussion through direct table reads', async () => {
    const mine = await createDraft(s.contributorA)
    const theirs = await createDraft(s.editorA)
    const mineSubmission = await submit(s.contributorA, mine.pageId, mine.revision)
    const theirSubmission = await submit(s.editorA, theirs.pageId, theirs.revision)
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [
        mine.pageId,
        mineSubmission.rows[0]!.version_id,
        'Visible to this submitter.',
        '[]',
      ]),
    )
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [
        theirs.pageId,
        theirSubmission.rows[0]!.version_id,
        'Private to the other review.',
        '[]',
      ]),
    )

    const contributor = await db.asUser(s.contributorA, client =>
      client.query<{ body: string }>(
        `SELECT body FROM comments
        WHERE item_id = ANY($1::uuid[])
        ORDER BY body`,
        [[mine.pageId, theirs.pageId]],
      ),
    )
    expect(contributor.rows.map(row => row.body)).toEqual(['Visible to this submitter.'])

    const reviewer = await db.asUser(s.editorA, client =>
      client.query<{ body: string }>(
        `SELECT body FROM comments
        WHERE item_id = ANY($1::uuid[])
        ORDER BY body`,
        [[mine.pageId, theirs.pageId]],
      ),
    )
    expect(reviewer.rows.map(row => row.body)).toEqual(['Private to the other review.', 'Visible to this submitter.'])
  })

  it('returns the safe queue and discussion models without exposing another contributor’s request', async () => {
    const mine = await createDraft(s.contributorA)
    const theirs = await createDraft(s.editorA)
    const mineSubmission = await submit(s.contributorA, mine.pageId, mine.revision, 'My request')
    await submit(s.editorA, theirs.pageId, theirs.revision, 'Their request')
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [
        mine.pageId,
        mineSubmission.rows[0]!.version_id,
        'A reviewer comment',
        JSON.stringify([s.contributorA]),
      ]),
    )

    const contributorQueue = await db.asUser(s.contributorA, client =>
      client.query<{
        request_note: string
        can_review: boolean
        submitted_by_name: string
      }>('SELECT request_note, can_review, submitted_by_name FROM app.review_queue(NULL,true,100)'),
    )
    expect(contributorQueue.rows).toContainEqual(
      expect.objectContaining({
        request_note: 'My request',
        can_review: false,
      }),
    )
    expect(contributorQueue.rows.some(row => row.request_note === 'Their request')).toBe(false)

    const discussion = await db.asUser(s.contributorA, client =>
      client.query<{
        body: string
        author_name: string
      }>('SELECT body, author_name FROM app.review_comments($1)', [mineSubmission.rows[0]!.submission_id]),
    )
    expect(discussion.rows).toEqual([expect.objectContaining({ body: 'A reviewer comment' })])

    const reviewerQueue = await db.asUser(s.editorA, client =>
      client.query<{
        request_note: string
        can_review: boolean
      }>('SELECT request_note, can_review FROM app.review_queue($1,true,100)', [s.siteA]),
    )
    expect(reviewerQueue.rows.filter(row => ['My request', 'Their request'].includes(row.request_note))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ request_note: 'My request', can_review: true }),
        expect.objectContaining({ request_note: 'Their request', can_review: true }),
      ]),
    )
  })
})

describe('review read models', () => {
  it('finds an exact older request before applying the queue limit', async () => {
    const older = await createDraft(s.contributorA)
    const olderSubmission = await submit(s.contributorA, older.pageId, older.revision, 'Older exact request')
    const newer = await createDraft(s.contributorA)
    await submit(s.contributorA, newer.pageId, newer.revision, 'Newer queue request')

    const firstPage = await db.asUser(s.contributorA, client =>
      client.query<{
        submission_id: string
      }>('SELECT submission_id FROM app.review_queue(NULL,true,1,NULL,NULL)'),
    )
    expect(firstPage.rows[0]!.submission_id).not.toBe(olderSubmission.rows[0]!.submission_id)

    const exact = await db.asUser(s.contributorA, client =>
      client.query<{
        submission_id: string
        request_note: string
      }>('SELECT submission_id, request_note FROM app.review_queue(NULL,true,1,$1,NULL)', [
        olderSubmission.rows[0]!.submission_id,
      ]),
    )
    expect(exact.rows).toEqual([
      {
        submission_id: olderSubmission.rows[0]!.submission_id,
        request_note: 'Older exact request',
      },
    ])
  })

  it('returns capability-matched approval and comment-resolution controls', async () => {
    const draft = await createDraft(s.contributorA)
    const content = JSON.parse(heroContent(s.heroDefId)) as Record<string, unknown>[]
    content[0]!['raw_html'] = '<p>Governed review</p>'
    const changed = await db.asUser(s.superAdmin, client =>
      client.query<{ revision: string }>('SELECT revision FROM app.save_page_draft($1,$2,$3,$4)', [
        draft.pageId,
        draft.revision,
        JSON.stringify(content),
        '{}',
      ]),
    )
    const opened = await submit(s.contributorA, draft.pageId, Number(changed.rows[0]!.revision))
    const submissionId = opened.rows[0]!.submission_id
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [
        draft.pageId,
        opened.rows[0]!.version_id,
        'Reviewer-only resolution',
        '[]',
      ]),
    )

    const editorQueue = await db.asUser(s.editorA, client =>
      client.query<{
        can_review: boolean
        can_approve: boolean
      }>('SELECT can_review, can_approve FROM app.review_queue(NULL,true,1,$1,NULL)', [submissionId]),
    )
    expect(editorQueue.rows[0]).toEqual({ can_review: true, can_approve: false })

    const rootQueue = await db.asUser(s.superAdmin, client =>
      client.query<{
        can_review: boolean
        can_approve: boolean
      }>('SELECT can_review, can_approve FROM app.review_queue(NULL,true,1,$1,NULL)', [submissionId]),
    )
    expect(rootQueue.rows[0]).toEqual({ can_review: true, can_approve: true })

    const contributorComments = await db.asUser(s.contributorA, client =>
      client.query<{
        can_resolve: boolean
      }>('SELECT can_resolve FROM app.review_comments($1)', [submissionId]),
    )
    expect(contributorComments.rows[0]!.can_resolve).toBe(false)

    const reviewerComments = await db.asUser(s.editorA, client =>
      client.query<{
        can_resolve: boolean
      }>('SELECT can_resolve FROM app.review_comments($1)', [submissionId]),
    )
    expect(reviewerComments.rows[0]!.can_resolve).toBe(true)
  })
})
