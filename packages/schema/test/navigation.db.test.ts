import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('navigation')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

async function navHead() {
  return db.asUser(
    s.editorA,
    async client =>
      (
        await client.query<{
          id: string
          revision: string
          mode: string
          draft: unknown[]
          published: unknown[]
        }>(
          `SELECT n.id, n.revision, n.mode, draft.tree AS draft, live.tree AS published
       FROM navigations n
       JOIN navigation_versions draft ON draft.id = n.draft_version_id
       JOIN navigation_versions live ON live.id = n.published_version_id
      WHERE n.site_id = $1`,
          [s.siteA],
        )
      ).rows[0]!,
  )
}

async function savePage(pageId: string, revision: number, heading: string) {
  await db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      pageId,
      revision,
      heroContent(s.heroDefId, heading),
      '{}',
    ]),
  )
}

async function publishPage(pageId: string, revision: number) {
  await db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [pageId, revision, ...CHECKED_CLEAN]),
  )
}

describe('navigation is a versioned site artifact', () => {
  it('auto-adds a newly published page to draft, live shell and audit', async () => {
    await savePage(s.pageA, 0, 'Home')
    await publishPage(s.pageA, 1)

    const head = await navHead()
    expect(head.draft).toEqual(head.published)
    expect(head.published).toEqual([
      {
        label: 'Home',
        target: { type: 'page', page_id: s.pageA },
        visible: true,
      },
    ])

    const shell = await db.asUser(s.editorA, client =>
      client.query<{
        navigation: unknown[]
      }>("SELECT payload->'navigation' AS navigation FROM published_site_shells WHERE site_id = $1", [s.siteA]),
    )
    expect(shell.rows[0]!.navigation).toEqual(head.published)

    const audit = await db.asUser(s.editorA, client =>
      client.query("SELECT id FROM audit_log WHERE site_id = $1 AND action = 'navigation.auto_sync'", [s.siteA]),
    )
    expect(audit.rows).toHaveLength(1)
  })

  it('validates the tree twice and refuses wrong-tenant page targets', async () => {
    const head = await navHead()
    const unsafe = [{ label: 'No', target: { type: 'url', url: 'javascript:alert(1)' }, visible: true }]
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
          s.siteA,
          head.revision,
          JSON.stringify(unsafe),
          'auto',
        ]),
      ),
      'CMS04',
    )

    const otherPage = await db.asUser(
      s.editorB,
      async client =>
        (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteB, '', 'Other site home']))
          .rows[0]!.id,
    )
    const crossed = [{ label: 'Other', target: { type: 'page', page_id: otherPage }, visible: true }]
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
          s.siteA,
          head.revision,
          JSON.stringify(crossed),
          'auto',
        ]),
      ),
      'CMS04',
    )

    await expectSqlState(
      db.asUser(s.contributorA, client =>
        client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
          s.siteA,
          head.revision,
          JSON.stringify(head.draft),
          'auto',
        ]),
      ),
      'CMS02',
    )
  })

  it('keeps an unrelated draft private while page auto-sync advances live navigation', async () => {
    const before = await navHead()
    const edited = [
      {
        label: 'Welcome',
        target: { type: 'page', page_id: s.pageA },
        visible: true,
      },
      {
        label: 'Salvation Army',
        target: { type: 'url', url: 'https://www.salvationarmyusa.org/' },
        visible: true,
      },
    ]
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
        s.siteA,
        before.revision,
        JSON.stringify(edited),
        'auto',
      ]),
    )

    const page2 = await db.asUser(
      s.editorA,
      async client =>
        (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'about', 'About us']))
          .rows[0]!.id,
    )
    await savePage(page2, 0, 'About us')
    await publishPage(page2, 1)

    const advanced = await navHead()
    expect(advanced.draft).toEqual(edited)
    expect(advanced.published).toEqual([
      { label: 'Home', target: { type: 'page', page_id: s.pageA }, visible: true },
      { label: 'About us', target: { type: 'page', page_id: page2 }, visible: true },
    ])

    const published = await db.asUser(s.editorA, client =>
      client.query<{
        revision: string
        shell_revision: string
      }>('SELECT revision, shell_revision FROM app.publish_navigation($1,$2)', [s.siteA, advanced.revision]),
    )
    expect(Number(published.rows[0]!.revision)).toBe(Number(advanced.revision) + 1)

    const final = await navHead()
    expect(final.draft).toEqual(final.published)
    expect(final.published).toEqual([
      ...edited,
      { label: 'About us', target: { type: 'page', page_id: page2 }, visible: true },
    ])
    const outbox = await db.as('owner', client =>
      client.query("SELECT id FROM outbox WHERE site_id = $1 AND event_type = 'site_shell.published'", [s.siteA]),
    )
    expect(outbox.rows.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps custom labels, visibility and position when page content is republished', async () => {
    const before = await navHead()
    const tree = before.published.map((node, index) => (index === 0 ? { ...(node as object), visible: false } : node))
    await db.asUser(s.editorA, async client => {
      const saved = (
        await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
          s.siteA,
          before.revision,
          JSON.stringify(tree),
          'auto',
        ])
      ).rows[0]!
      await client.query('SELECT app.publish_navigation($1,$2)', [s.siteA, saved.revision])
      const head = (await client.query('SELECT revision FROM pages WHERE id=$1', [s.pageA])).rows[0]!
      const draft = (
        await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          s.pageA,
          head.revision,
          heroContent(s.heroDefId, 'Updated home content'),
          '{}',
        ])
      ).rows[0]!
      await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, draft.revision, ...CHECKED_CLEAN])
    })
    expect((await navHead()).published).toEqual(tree)
  })

  it('manual mode leaves future page publication out of navigation', async () => {
    const head = await navHead()
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
        s.siteA,
        head.revision,
        JSON.stringify(head.draft),
        'manual',
      ]),
    )
    const saved = await navHead()
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.publish_navigation($1,$2)', [s.siteA, saved.revision]),
    )

    const page3 = await db.asUser(
      s.editorA,
      async client =>
        (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'contact', 'Contact']))
          .rows[0]!.id,
    )
    await savePage(page3, 0, 'Contact')
    await publishPage(page3, 1)

    const final = await navHead()
    expect(JSON.stringify(final.published)).not.toContain(page3)
  })

  it('publishes a page safely when an automatic menu is already at capacity', async () => {
    const head = await navHead()
    const full = Array.from({ length: 50 }, (_, index) => ({
      label: `Resource ${index + 1}`,
      target: { type: 'url', url: `/resource-${index + 1}` },
      visible: true,
    }))
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
        s.siteA,
        head.revision,
        JSON.stringify(full),
        'auto',
      ]),
    )
    const saved = await navHead()
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.publish_navigation($1,$2)', [s.siteA, saved.revision]),
    )

    const page4 = await db.asUser(
      s.editorA,
      async client =>
        (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'stories', 'Stories']))
          .rows[0]!.id,
    )
    await savePage(page4, 0, 'Stories')
    await publishPage(page4, 1)

    const final = await navHead()
    expect(final.published).toHaveLength(50)
    expect(JSON.stringify(final.published)).not.toContain(page4)
    const skipped = await db.asUser(s.editorA, client =>
      client.query(
        "SELECT detail->>'reason' AS reason FROM audit_log WHERE site_id = $1 AND action = 'navigation.auto_sync_skipped'",
        [s.siteA],
      ),
    )
    expect(skipped.rows).toEqual([{ reason: 'navigation_at_capacity' }])
  })
})

describe('explicit dropdown groups', () => {
  it('saves a root group through the normal command while keeping draft separate from live', async () => {
    const head = await navHead(),
      tree = [
        {
          label: 'Group',
          target: { type: 'url', url: '/' },
          visible: true,
          dropdownGroup: true,
          children: [{ label: 'Visit', target: { type: 'url', url: '/visit' }, visible: true }],
        },
      ]
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
        s.siteA,
        head.revision,
        JSON.stringify(tree),
        'manual',
      ]),
    )
    const next = await navHead()
    expect(next.draft).toEqual(tree)
    expect(next.published).toEqual(head.published)
  })
  it('rejects empty groups, nested group flags, unknown fields and cross-site writers', async () => {
    const base = { label: 'Group', target: { type: 'url', url: '/' }, visible: true, dropdownGroup: true }
    for (const tree of [
      [base],
      [{ ...base, children: [base] }],
      [
        {
          ...base,
          children: [{ label: 'Visit', target: { type: 'url', url: '/visit' }, visible: true }],
          code: 'unsafe',
        },
      ],
    ]) {
      const head = await navHead()
      await expectSqlState(
        db.asUser(s.editorA, client =>
          client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
            s.siteA,
            head.revision,
            JSON.stringify(tree),
            'manual',
          ]),
        ),
        'CMS04',
      )
    }
    const head = await navHead()
    await expectSqlState(
      db.asUser(s.editorB, client =>
        client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
          s.siteA,
          head.revision,
          JSON.stringify(head.draft),
          'manual',
        ]),
      ),
      'CMS02',
    )
  })
})
