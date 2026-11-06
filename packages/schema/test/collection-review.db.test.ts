import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { expectSqlState, TestDatabase } from './harness.ts'

const fields = [{ key: 'title', label: 'Title', required: true, type: 'text' }]
const presentation = { schemaVersion: 1, titleField: 'title', subtitleField: null, imageField: null, groupField: null }
let serial = 0

describe('whole-collection immutable review boundary', () => {
  let db: TestDatabase
  let s: Scenario
  beforeAll(async () => {
    db = await TestDatabase.create('collection_review')
    s = await seedScenario(db)
  })
  afterAll(async () => db.close())
  const query = (actor: string | null, sql: string, args: unknown[] = []) => db.asUser(actor, c => c.query(sql, args))
  async function draft(publishSchema = true) {
    const key = `review-${++serial}`
    const created = (
      await query(s.superAdmin, 'SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        key,
        key,
        key.replace('-', '_'),
        JSON.stringify(fields),
        JSON.stringify(presentation),
      ])
    ).rows[0]!
    if (publishSchema)
      await query(s.superAdmin, 'SELECT * FROM app.publish_collection_schema($1,1)', [created.collection_id])
    await query(s.contributorA, 'SELECT * FROM app.save_collection_entries($1,0,$2)', [
      created.collection_id,
      JSON.stringify([{ id: null, stableKey: 'first', values: { title: 'Submitted title' } }]),
    ])
    return { id: created.collection_id as string, revision: publishSchema ? 2 : 1 }
  }
  async function submit(d: { id: string; revision: number }) {
    return (
      await query(s.contributorA, 'SELECT app.submit_collection_for_review($1,$2,1,$3) AS id', [
        d.id,
        d.revision,
        'Please review',
      ])
    ).rows[0]!.id as string
  }
  it('submits once, queues only to authorized readers, and publishes the inspected immutable pins', async () => {
    const d = await draft()
    const id = await submit(d)
    expect(await submit(d)).toBe(id)
    const review = (await query(s.editorA, 'SELECT app.collection_review_queue(NULL,$1,NULL) AS data', [id])).rows[0]!
      .data
    expect(review.submitted.entries[0].values.title).toBe('Submitted title')
    expect(review.live.entries).toEqual([])
    expect((await query(s.editorB, 'SELECT * FROM app.collection_review_queue(NULL,$1,NULL)', [id])).rows).toHaveLength(
      0,
    )
    await expectSqlState(query(s.contributorA, "SELECT app.decide_collection_review($1,true,'')", [id]), 'CMS02')
    await expectSqlState(query(s.editorA, 'SELECT * FROM app.publish_collection_entries($1,1)', [d.id]), 'CMS04')
    await expectSqlState(query(s.editorA, 'SELECT * FROM app.publish_collection_entries_core($1,1)', [d.id]), '42501')
    const result = await query(s.editorA, "SELECT app.decide_collection_review($1,true,'') AS id", [id])
    expect((await query(s.editorA, "SELECT app.decide_collection_review($1,true,'') AS id", [id])).rows).toEqual(
      result.rows,
    )
    const live = (
      await query(s.editorA, 'SELECT published_version_id FROM collection_entries WHERE collection_id=$1', [d.id])
    ).rows[0]!
    expect(live.published_version_id).toBe(review.submitted.entries[0].versionId)
    expect(
      (
        await query(
          s.editorA,
          "SELECT count(*)::int AS n FROM audit_log WHERE action='collection.review.approved' AND item_id=$1",
          [d.id],
        )
      ).rows[0]!.n,
    ).toBe(1)
  })
  it('supersedes after edits, refuses stale approval, and retains exact old/new comparison evidence', async () => {
    const d = await draft()
    const id = await submit(d)
    const entry = (await query(s.contributorA, 'SELECT id FROM collection_entries WHERE collection_id=$1', [d.id]))
      .rows[0]!
    await query(s.contributorA, 'SELECT * FROM app.save_collection_entries($1,1,$2)', [
      d.id,
      JSON.stringify([{ id: entry.id, stableKey: 'first', values: { title: 'New draft' } }]),
    ])
    await expectSqlState(query(s.editorA, "SELECT app.decide_collection_review($1,true,'')", [id]), 'CMS01')
    const r = (await query(s.contributorA, 'SELECT app.collection_review_queue(NULL,$1,NULL) AS data', [id])).rows[0]!
      .data
    expect(r.status).toBe('superseded')
    expect(r.isCurrent).toBe(false)
    expect(r.submitted.entries[0].values.title).toBe('Submitted title')
    expect(r.current.entries[0].values.title).toBe('New draft')
    await expectSqlState(
      query(s.contributorA, "UPDATE collection_review_snapshots SET submitted='{}' WHERE id=$1", [r.snapshotId]),
      '42501',
    )
  })
  it('returns feedback and supports scoped mentions and comment resolution', async () => {
    const d = await draft()
    const id = await submit(d)
    await expectSqlState(
      query(s.contributorA, 'SELECT app.add_collection_review_comment($1,$2,$3)', [
        id,
        'Question',
        JSON.stringify([s.editorB]),
      ]),
      'CMS04',
    )
    const comment = (
      await query(s.contributorA, 'SELECT app.add_collection_review_comment($1,$2,$3) AS id', [
        id,
        'Please check title',
        JSON.stringify([s.editorA]),
      ])
    ).rows[0]!.id
    await expectSqlState(query(s.editorB, 'SELECT app.resolve_collection_review_comment($1,true)', [comment]), 'CMS03')
    await query(s.editorA, 'SELECT app.resolve_collection_review_comment($1,true)', [comment])
    expect(
      (await query(s.editorA, 'SELECT app.collection_review_comments($1) AS data', [id])).rows[0]!.data.resolvedAt,
    ).not.toBeNull()
    await query(s.editorA, 'SELECT app.decide_collection_review($1,false,$2)', [id, 'Clarify the title'])
    const r = (await query(s.contributorA, 'SELECT app.collection_review_queue(NULL,$1,NULL) AS data', [id])).rows[0]!
      .data
    expect(r.status).toBe('rejected')
    expect(r.decisionNote).toBe('Clarify the title')
    expect(
      (
        await query(s.contributorA, 'SELECT published_version_id FROM collection_entries WHERE collection_id=$1', [
          d.id,
        ])
      ).rows[0]!.published_version_id,
    ).toBeNull()
  })
  it('requires schema administrators when an unpublished field model is included and rolls back failed approval', async () => {
    const d = await draft(false)
    const id = await submit(d)
    expect(
      (await query(s.editorA, 'SELECT app.collection_review_queue(NULL,$1,NULL) AS data', [id])).rows[0]!.data
        .canApprove,
    ).toBe(false)
    await expectSqlState(query(s.editorA, "SELECT app.decide_collection_review($1,true,'')", [id]), 'CMS02')
    expect((await query(s.editorA, 'SELECT status FROM collection_reviews WHERE id=$1', [id])).rows[0]!.status).toBe(
      'open',
    )
    await query(s.superAdmin, "SELECT app.decide_collection_review($1,true,'')", [id])
    expect((await query(s.editorA, 'SELECT status FROM collection_reviews WHERE id=$1', [id])).rows[0]!.status).toBe(
      'approved',
    )
  })
})
