import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../src/migrate/index.ts'
import { CHECKED_CLEAN, TestDatabase, expectSqlState, requireTestDatabase } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

type Heads = {
  header_id: string
  header_revision: string
  header_draft_id: string
  header_live_id: string
  header_draft: Record<string, unknown>
  header_live: Record<string, unknown>
  footer_id: string
  footer_revision: string
  footer_draft_id: string
  footer_live_id: string
  footer_draft: Record<string, unknown>
  footer_live: Record<string, unknown>
}

beforeAll(async () => {
  db = await TestDatabase.create('global-elements')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

async function heads(siteId = s.siteA, userId = s.editorA): Promise<Heads> {
  return db.asUser(
    userId,
    async client =>
      (
        await client.query<Heads>(
          `SELECT h.id AS header_id, h.revision AS header_revision,
            h.draft_version_id AS header_draft_id, h.published_version_id AS header_live_id,
            hd.content AS header_draft, hl.content AS header_live,
            f.id AS footer_id, f.revision AS footer_revision,
            f.draft_version_id AS footer_draft_id, f.published_version_id AS footer_live_id,
            fd.content AS footer_draft, fl.content AS footer_live
       FROM global_elements h
       JOIN global_element_versions hd ON hd.id = h.draft_version_id
       JOIN global_element_versions hl ON hl.id = h.published_version_id
       JOIN global_elements f ON f.site_id = h.site_id AND f.kind = 'footer'
       JOIN global_element_versions fd ON fd.id = f.draft_version_id
       JOIN global_element_versions fl ON fl.id = f.published_version_id
      WHERE h.site_id = $1 AND h.kind = 'header'`,
          [siteId],
        )
      ).rows[0]!,
  )
}

function changedHeader(current: Heads, overrides: Record<string, unknown> = {}) {
  return {
    ...current.header_live,
    preset: 'compact',
    sticky: true,
    utilityLinks: [{ label: 'Give', target: { type: 'url', url: '/give' } }],
    cta: { label: 'Donate', target: { type: 'url', url: 'https://example.test/give' } },
    ...overrides,
  }
}

function changedFooter(current: Heads, overrides: Record<string, unknown> = {}) {
  return {
    ...current.footer_live,
    preset: 'columns',
    groups: [{ heading: 'Explore', links: [{ label: 'About', target: { type: 'url', url: '/about' } }] }],
    contact: { heading: 'Contact', email: 'hello@example.test' },
    social: [{ service: 'facebook', url: 'https://facebook.com/example' }],
    legal: {
      copyright: '© Site A',
      privacy: { label: 'Privacy', target: { type: 'url', url: '/privacy' } },
      accessibility: null,
      terms: null,
    },
    ...overrides,
  }
}

async function save(header: unknown, footer: unknown, current?: Heads, userId = s.editorA) {
  const loaded = current ?? (await heads())
  return db.asUser(userId, client =>
    client.query<{
      header_version_id: string
      header_revision: string
      footer_version_id: string
      footer_revision: string
    }>('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      s.siteA,
      loaded.header_revision,
      loaded.footer_revision,
      JSON.stringify(header),
      JSON.stringify(footer),
    ]),
  )
}

async function publish(current?: Heads, userId = s.editorA) {
  const loaded = current ?? (await heads())
  return db.asUser(userId, client =>
    client.query<{
      header_version_id: string
      header_revision: string
      footer_version_id: string
      footer_revision: string
      shell_revision: string
    }>('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
      s.siteA,
      loaded.header_revision,
      loaded.footer_revision,
    ]),
  )
}

async function revert(current?: Heads) {
  const loaded = current ?? (await heads())
  return db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.revert_global_elements_to_live($1,$2,$3)', [
      s.siteA,
      loaded.header_revision,
      loaded.footer_revision,
    ]),
  )
}

async function publishPage(pageId: string, revision: number) {
  return db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [pageId, revision, ...CHECKED_CLEAN]),
  )
}

describe('global-element bootstrap and bounded persistence', () => {
  it('backfills explicit baseline versions for a site created before migration 0045', async () => {
    const database = `cms_global_upgrade_${randomUUID().slice(0, 8)}`
    const admin = new Client({ connectionString: requireTestDatabase() })
    await admin.connect()
    let legacy: Client | undefined
    try {
      await admin.query(`CREATE DATABASE ${database}`)
      const parsed = new URL(requireTestDatabase())
      parsed.pathname = `/${database}`
      const url = parsed.toString()
      await migrate(url, { through: '0044_theme_workspace.sql' })
      legacy = new Client({ connectionString: url })
      await legacy.connect()
      const actor = '20000000-0000-4000-8000-000000000001'
      await legacy.query("INSERT INTO app_users(id,email,display_name) VALUES($1,'legacy@example.test','Legacy')", [
        actor,
      ])
      const site = (
        await legacy.query<{ id: string }>(
          "INSERT INTO sites(slug,name,kind,created_by) VALUES('legacy-site','Legacy Site','resource',$1) RETURNING id",
          [actor],
        )
      ).rows[0]!.id
      expect((await legacy.query('SELECT id FROM global_elements WHERE site_id=$1', [site])).rows).toHaveLength(0)
      await legacy.end()
      legacy = undefined
      await migrate(url)
      legacy = new Client({ connectionString: url })
      await legacy.connect()
      const rows = await legacy.query<{ kind: string; revision: string; content: { enabled: boolean } }>(
        `SELECT g.kind,g.revision,v.content FROM global_elements g
           JOIN global_element_versions v ON v.id=g.published_version_id
          WHERE g.site_id=$1 ORDER BY g.kind`,
        [site],
      )
      expect(rows.rows).toEqual([
        expect.objectContaining({ kind: 'header', revision: '1', content: expect.objectContaining({ enabled: true }) }),
        expect.objectContaining({ kind: 'footer', revision: '1', content: expect.objectContaining({ enabled: true }) }),
      ])
      const shell = await legacy.query<{ header: { enabled: boolean }; footer: { enabled: boolean } }>(
        "SELECT payload->'header' AS header,payload->'footer' AS footer FROM published_site_shells WHERE site_id=$1",
        [site],
      )
      expect(shell.rows[0]).toEqual({
        header: expect.objectContaining({ enabled: true }),
        footer: expect.objectContaining({ enabled: true }),
      })
    } finally {
      await legacy?.end()
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)

  it('preserves existing live frames and creates private header and footer drafts for future sites', async () => {
    const current = await heads()
    expect(current.header_revision).toBe('1')
    expect(current.footer_revision).toBe('1')
    expect(current.header_draft_id).toBe(current.header_live_id)
    expect(current.footer_draft_id).toBe(current.footer_live_id)
    expect(current.header_live).toMatchObject({
      schemaVersion: 1,
      enabled: true,
      preset: 'standard',
      surface: 'page',
      sticky: false,
      brand: { siteName: 'Site A', showName: true, logoMediaId: null, compactLogoMediaId: null },
    })
    expect(current.footer_live).toMatchObject({
      schemaVersion: 1,
      enabled: true,
      preset: 'simple',
      brand: { siteName: 'Site A', showFoundation: true },
    })

    const future = await db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query<{ id: string }>('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
            'future-site',
            'Future Site',
            'resource',
            'future-site.staging.example.test',
            JSON.stringify({ colors: { primary: '#000000' }, fonts: { heading: 'serif', body: 'sans-serif' } }),
            '[]',
          ])
        ).rows[0]!.id,
    )
    const rows = await db.asUser(s.superAdmin, client =>
      client.query<{
        kind: string
        revision: string
        draft: string
        live: string
        enabled: boolean
      }>(
        `SELECT g.kind, g.revision, g.draft_version_id AS draft, g.published_version_id AS live,
              (v.content->>'enabled')::boolean AS enabled
         FROM global_elements g JOIN global_element_versions v ON v.id = g.draft_version_id
        WHERE g.site_id = $1 ORDER BY g.kind`,
        [future],
      ),
    )
    expect(rows.rows).toEqual([
      expect.objectContaining({ kind: 'header', revision: '1', enabled: true }),
      expect.objectContaining({ kind: 'footer', revision: '1', enabled: true }),
    ])
    expect(rows.rows.every(row => row.draft !== null && row.live === null)).toBe(true)
    const shell = await db.asUser(s.superAdmin, client =>
      client.query<{
        name: string
        header: { enabled: boolean }
        footer: { enabled: boolean }
      }>(
        `SELECT payload->'site'->>'name' AS name,payload->'header' AS header,payload->'footer' AS footer
          FROM published_site_shells WHERE site_id=$1`,
        [future],
      ),
    )
    expect(shell.rows).toEqual([])
  })

  it.each([
    ['unknown header property', (h: Heads) => ({ ...h.header_live, surprise: true }), (h: Heads) => h.footer_live],
    [
      'unbounded utility links',
      (h: Heads) => ({
        ...h.header_live,
        utilityLinks: Array(5).fill({ label: 'x', target: { type: 'url', url: '/x' } }),
      }),
      (h: Heads) => h.footer_live,
    ],
    [
      'unsafe CTA URL',
      (h: Heads) => ({ ...h.header_live, cta: { label: 'x', target: { type: 'url', url: 'javascript:alert(1)' } } }),
      (h: Heads) => h.footer_live,
    ],
    [
      'an empty CTA label',
      (h: Heads) => ({ ...h.header_live, cta: { label: '', target: { type: 'url', url: '/give' } } }),
      (h: Heads) => h.footer_live,
    ],
    [
      'unknown footer property',
      (h: Heads) => h.header_live,
      (h: Heads) => ({ ...h.footer_live, customHtml: '<script>' }),
    ],
    [
      'unbounded footer groups',
      (h: Heads) => h.header_live,
      (h: Heads) => ({ ...h.footer_live, groups: Array(5).fill({ heading: 'x', links: [] }) }),
    ],
    [
      'unknown social service',
      (h: Heads) => h.header_live,
      (h: Heads) => ({ ...h.footer_live, social: [{ service: 'myspace', url: 'https://example.test' }] }),
    ],
    [
      'malformed page target',
      (h: Heads) => ({ ...h.header_live, utilityLinks: [{ label: 'x', target: { type: 'page', page_id: 'nope' } }] }),
      (h: Heads) => h.footer_live,
    ],
    [
      'a partner with an extra property',
      (h: Heads) => ({ ...h.header_live, partner: { label: 'With', name: 'Lilly School', url: null, logo: 'x' } }),
      (h: Heads) => h.footer_live,
    ],
    [
      'a partner without a name',
      (h: Heads) => ({ ...h.header_live, partner: { label: 'In partnership with', name: ' ', url: null } }),
      (h: Heads) => h.footer_live,
    ],
    [
      'a partner address that runs script',
      (h: Heads) => ({
        ...h.header_live,
        partner: { label: 'With', name: 'Lilly School', url: 'javascript:alert(1)' },
      }),
      (h: Heads) => h.footer_live,
    ],
    [
      'an insecure partner address',
      (h: Heads) => ({
        ...h.header_live,
        partner: { label: 'With', name: 'Lilly School', url: 'http://example.test/' },
      }),
      (h: Heads) => h.footer_live,
    ],
  ])('refuses %s at the PostgreSQL save boundary', async (_label, headerFor, footerFor) => {
    const current = await heads()
    await expectSqlState(save(headerFor(current), footerFor(current), current), 'CMS04')
  })
})

describe('combined private draft, publish, and revert', () => {
  it('keeps both drafts private then publishes both atomically with one shell rebuild', async () => {
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        0,
        heroContent(s.heroDefId, 'Home'),
        '{}',
      ]),
    )
    await publishPage(s.pageA, 1)
    const before = await heads()
    const shellBefore = await db.as(
      'owner',
      async client =>
        (
          await client.query<{
            revision: string
            header: unknown
            footer: unknown
          }>(
            "SELECT revision, payload->'header' AS header, payload->'footer' AS footer FROM published_site_shells WHERE site_id=$1",
            [s.siteA],
          )
        ).rows[0]!,
    )

    const header = changedHeader(before)
    const footer = changedFooter(before)
    const saved = await save(header, footer, before)
    const privateHeads = await heads()
    expect(privateHeads.header_live_id).toBe(before.header_live_id)
    expect(privateHeads.footer_live_id).toBe(before.footer_live_id)
    expect(privateHeads.header_draft).toEqual(header)
    expect(privateHeads.footer_draft).toEqual(footer)
    const privateShell = await db.as(
      'owner',
      async client =>
        (
          await client.query<{
            revision: string
            header: unknown
            footer: unknown
          }>(
            "SELECT revision, payload->'header' AS header, payload->'footer' AS footer FROM published_site_shells WHERE site_id=$1",
            [s.siteA],
          )
        ).rows[0]!,
    )
    expect(privateShell).toEqual(shellBefore)

    const result = await publish(privateHeads)
    const live = await heads()
    expect(live.header_live).toEqual(header)
    expect(live.footer_live).toEqual(footer)
    expect(live.header_live_id).toBe(result.rows[0]!.header_version_id)
    expect(live.footer_live_id).toBe(result.rows[0]!.footer_version_id)
    expect(Number(result.rows[0]!.shell_revision)).toBe(Number(shellBefore.revision) + 1)

    const evidence = await db.as('owner', async client => ({
      shell: (
        await client.query<{ header: unknown; footer: unknown }>(
          "SELECT payload->'header' AS header, payload->'footer' AS footer FROM published_site_shells WHERE site_id=$1",
          [s.siteA],
        )
      ).rows[0]!,
      audits: (
        await client.query<{ action: string }>(
          "SELECT action FROM audit_log WHERE site_id=$1 AND action LIKE 'global_elements.%' ORDER BY created_at",
          [s.siteA],
        )
      ).rows,
      event: (
        await client.query<{ payload: { paths: string[] } }>(
          "SELECT payload FROM outbox WHERE site_id=$1 AND event_type='site_shell.published' ORDER BY created_at DESC LIMIT 1",
          [s.siteA],
        )
      ).rows[0]!,
    }))
    expect(evidence.shell).toEqual({ header, footer })
    expect(evidence.audits.map(row => row.action)).toEqual(['global_elements.save', 'global_elements.publish'])
    expect(evidence.event.payload.paths).toEqual(['/'])

    const savedRows = await db.as('owner', client =>
      client.query<{ id: string; content: unknown }>(
        'SELECT id,content FROM global_element_versions WHERE id=ANY($1::uuid[]) ORDER BY id',
        [[saved.rows[0]!.header_version_id, saved.rows[0]!.footer_version_id]],
      ),
    )
    expect(savedRows.rows).toHaveLength(2)
    expect(savedRows.rows.map(row => row.content)).toEqual(expect.arrayContaining([header, footer]))
  })

  it('uses independent strict CAS for both heads and real role boundaries', async () => {
    const current = await heads()
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
          s.siteA,
          Number(current.header_revision) - 1,
          current.footer_revision,
          JSON.stringify(current.header_live),
          JSON.stringify(current.footer_live),
        ]),
      ),
      'CMS01',
    )
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
          s.siteA,
          current.header_revision,
          Number(current.footer_revision) - 1,
          JSON.stringify(current.header_live),
          JSON.stringify(current.footer_live),
        ]),
      ),
      'CMS01',
    )
    await expectSqlState(
      db.asUser(s.contributorA, client =>
        client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
          s.siteA,
          current.header_revision,
          current.footer_revision,
          JSON.stringify(current.header_live),
          JSON.stringify(current.footer_live),
        ]),
      ),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.editorB, client =>
        client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
          s.siteA,
          current.header_revision,
          current.footer_revision,
        ]),
      ),
      'CMS02',
    )
  })

  it('reverts both private drafts by appending versions copied from live', async () => {
    const before = await heads()
    await save(changedHeader(before, { surface: 'accent' }), changedFooter(before, { preset: 'contact' }), before)
    const drafted = await heads()
    await revert(drafted)
    const after = await heads()
    expect(after.header_draft).toEqual(after.header_live)
    expect(after.footer_draft).toEqual(after.footer_live)
    expect(after.header_draft_id).not.toBe(after.header_live_id)
    expect(after.footer_draft_id).not.toBe(after.footer_live_id)
    expect(Number(after.header_revision)).toBe(Number(drafted.header_revision) + 1)
    expect(Number(after.footer_revision)).toBe(Number(drafted.footer_revision) + 1)
  })
})

describe('publication readiness and fail-closed legacy handling', () => {
  it('refuses an empty enabled group atomically, leaving both live pointers unchanged', async () => {
    const before = await heads()
    await save(
      changedHeader(before, { surface: 'primary' }),
      changedFooter(before, { groups: [{ heading: 'Empty', links: [] }] }),
      before,
    )
    const drafted = await heads()
    const versionsBefore = await db.as('owner', async client =>
      Number(
        (
          await client.query<{ count: string }>('SELECT count(*) FROM global_element_versions WHERE site_id=$1', [
            s.siteA,
          ])
        ).rows[0]!.count,
      ),
    )
    await expectSqlState(publish(drafted), 'CMS04')
    const after = await heads()
    expect(after.header_live_id).toBe(before.header_live_id)
    expect(after.footer_live_id).toBe(before.footer_live_id)
    const versionsAfter = await db.as('owner', async client =>
      Number(
        (
          await client.query<{ count: string }>('SELECT count(*) FROM global_element_versions WHERE site_id=$1', [
            s.siteA,
          ])
        ).rows[0]!.count,
      ),
    )
    expect(versionsAfter).toBe(versionsBefore)
    await revert(after)
  })

  it('refuses dead and cross-site page targets', async () => {
    const current = await heads()
    const missing = '10000000-0000-4000-8000-000000000001'
    await save(
      changedHeader(current, {
        utilityLinks: [{ label: 'Missing', target: { type: 'page', page_id: missing } }],
      }),
      current.footer_live,
      current,
    )
    await expectSqlState(publish(await heads()), 'CMS04')
    await revert(await heads())

    const other = await db.asUser(
      s.editorB,
      async client =>
        (
          await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteB,
            'elsewhere',
            'Elsewhere',
          ])
        ).rows[0]!.id,
    )
    await db.asUser(s.editorB, client =>
      client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        other,
        0,
        heroContent(s.heroDefId, 'Elsewhere'),
        '{}',
      ]),
    )
    await db.asUser(s.editorB, client =>
      client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [other, 1, ...CHECKED_CLEAN]),
    )
    const next = await heads()
    await save(
      changedHeader(next, {
        utilityLinks: [{ label: 'Other', target: { type: 'page', page_id: other } }],
      }),
      next.footer_live,
      next,
    )
    await expectSqlState(publish(await heads()), 'CMS04')
    await revert(await heads())
  })

  it.each(['processing', 'deleted', 'cross-site'])('refuses a %s logo', async state => {
    const mediaId = await db.as('owner', async client => {
      if (state === 'processing')
        return (
          await client.query<{ id: string }>(
            `INSERT INTO media(site_id,object_key,content_hash,original_name,alt_text,mime_type,status,uploaded_by)
         VALUES($1,$2,'','logo.png','Logo','image/png','processing',$3) RETURNING id`,
            [s.siteA, `test/${state}-logo.png`, s.editorA],
          )
        ).rows[0]!.id
      const siteId = state === 'cross-site' ? s.siteB : s.siteA
      const row = (
        await client.query<{ id: string }>(
          `INSERT INTO media(site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,uploaded_by)
         VALUES($1,$2,$3,'logo.png','Logo',200,100,1000,'image/png','ready',$4) RETURNING id`,
          [siteId, `test/${state}-logo.png`, 'a'.repeat(64), s.editorA],
        )
      ).rows[0]!.id
      if (state === 'deleted')
        await client.query("UPDATE media SET status='deleted',deleted_at=now() WHERE id=$1", [row])
      return row
    })
    const current = await heads()
    await save(
      {
        ...current.header_live,
        brand: { ...(current.header_live.brand as Record<string, unknown>), logoMediaId: mediaId },
      },
      current.footer_live,
      current,
    )
    await expectSqlState(publish(await heads()), 'CMS04')
    await revert(await heads())
  })

  it('accepts a ready logo owned by the site', async () => {
    const mediaId = await db.as('owner', async client => {
      const id = (
        await client.query<{ id: string }>(
          `INSERT INTO media(site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,uploaded_by)
         VALUES($1,'test/ready-logo.png',$2,'logo.png','Logo',200,100,1000,'image/png','ready',$3) RETURNING id`,
          [s.siteA, 'b'.repeat(64), s.editorA],
        )
      ).rows[0]!.id
      await client.query(
        `INSERT INTO media_variants(media_id,kind,object_key,width,height,bytes,content_hash,mime_type)
         VALUES($1,'thumbnail',$2,160,80,500,$3,'image/webp'),
               ($1,'wide',$4,800,400,1500,$5,'image/webp')`,
        [id, `test/${id}/thumbnail.webp`, 'd'.repeat(64), `test/${id}/wide.webp`, 'e'.repeat(64)],
      )
      return id
    })
    const current = await heads()
    await save(
      {
        ...current.header_live,
        brand: { ...(current.header_live.brand as Record<string, unknown>), logoMediaId: mediaId },
      },
      current.footer_live,
      current,
    )
    await publish(await heads())
    expect(((await heads()).header_live.brand as Record<string, unknown>).logoMediaId).toBe(mediaId)
  })

  it('accepts ready shared media as a governed cross-site brand logo', async () => {
    const mediaId = await db.as('owner', async client => {
      const id = (
        await client.query<{ id: string }>(
          `INSERT INTO media(site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,uploaded_by)
         VALUES(NULL,'shared/foundation-logo.png',$1,'foundation-logo.png','The Salvation Army',200,100,1000,'image/png','ready',$2)
         RETURNING id`,
          ['c'.repeat(64), s.superAdmin],
        )
      ).rows[0]!.id
      await client.query(
        `INSERT INTO media_variants(media_id,kind,object_key,width,height,bytes,content_hash,mime_type)
         VALUES($1,'thumbnail',$2,160,80,500,$3,'image/webp'),
               ($1,'wide',$4,800,400,1500,$5,'image/webp')`,
        [id, `shared/${id}/thumbnail.webp`, 'f'.repeat(64), `shared/${id}/wide.webp`, '1'.repeat(64)],
      )
      return id
    })
    const current = await heads()
    await save(
      {
        ...current.header_live,
        brand: { ...(current.header_live.brand as Record<string, unknown>), logoMediaId: mediaId },
      },
      current.footer_live,
      current,
    )
    await publish(await heads())
    expect(((await heads()).header_live.brand as Record<string, unknown>).logoMediaId).toBe(mediaId)
  })

  it('refuses a minimal enabled header once a second page is published', async () => {
    const second = await db.asUser(
      s.editorA,
      async client =>
        (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'about', 'About']))
          .rows[0]!.id,
    )
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        second,
        0,
        heroContent(s.heroDefId, 'About'),
        '{}',
      ]),
    )
    await publishPage(second, 1)
    const current = await heads()
    await save({ ...current.header_live, preset: 'minimal' }, current.footer_live, current)
    await expectSqlState(publish(await heads()), 'CMS04')
    await revert(await heads())
  })

  it('requires a super admin to hide the shared foundation', async () => {
    const current = await heads()
    const hidden = {
      ...current.footer_live,
      brand: { ...(current.footer_live.brand as Record<string, unknown>), showFoundation: false },
    }
    await save(current.header_live, hidden, current)
    const drafted = await heads()
    await expectSqlState(publish(drafted), 'CMS02')
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        s.siteA,
        drafted.header_revision,
        drafted.footer_revision,
      ]),
    )
    expect((await heads()).footer_live).toEqual(hidden)

    const restore = await heads()
    const shown = {
      ...restore.footer_live,
      brand: { ...(restore.footer_live.brand as Record<string, unknown>), showFoundation: true },
    }
    await save(restore.header_live, shown, restore)
    await publish(await heads())
  })

  it('fails closed on a corrupt manually stored draft and recovers only by reverting to valid live', async () => {
    const before = await heads()
    await db.as('owner', async client => {
      const bad = (
        await client.query<{ id: string }>(
          `INSERT INTO global_element_versions(site_id,global_element_id,revision,content,author_id)
         VALUES($1,$2,$3,'{}',$4) RETURNING id`,
          [s.siteA, before.header_id, Number(before.header_revision) + 1, s.editorA],
        )
      ).rows[0]!.id
      await client.query('UPDATE global_elements SET revision=revision+1,draft_version_id=$2 WHERE id=$1', [
        before.header_id,
        bad,
      ])
    })
    const corrupt = await heads()
    await expectSqlState(publish(corrupt), 'CMS04')
    await revert(corrupt)
    expect((await heads()).header_draft).toEqual((await heads()).header_live)
  })
})

// Last, because it saves drafts on site A that earlier tests count.
describe('a partner beside the brand', () => {
  // SPEC §6 step 4: an optional partner beside the brand (migration 0105).
  it('names a partner in a preset header, with or without an address, and keeps older headers valid', async () => {
    const current = await heads()
    expect(current.header_live).not.toHaveProperty('partner')
    const partnered = {
      ...current.header_live,
      partner: {
        label: 'In partnership with',
        name: 'Lilly Family School of Philanthropy',
        url: 'https://philanthropy.example.test/',
      },
    }
    await save(partnered, current.footer_live, current)
    expect((await heads()).header_draft).toEqual(partnered)
    const named = {
      ...current.header_live,
      partner: {
        label: 'With',
        name: 'A partner whose name is longer than eighty characters, which a header link label could not hold',
        url: '/partners',
      },
    }
    await save(named, current.footer_live)
    expect((await heads()).header_draft).toEqual(named)
    await save({ ...current.header_live, partner: null }, current.footer_live)
    expect((await heads()).header_draft).toEqual({ ...current.header_live, partner: null })
  })
})

it('keeps old preset headers valid and accepts only a valid additive logo description', async () => {
  const current = await heads(),
    brand = current.header_live.brand as Record<string, unknown>
  const old = { ...current.header_live, brand: { ...brand, logoMediaId: '00000000-0000-4000-8000-000000000001' } }
  const description = 'The Salvation Army Echelon — Mobilizing the next generation'
  await db.as('owner', async client => {
    for (const content of [old, { ...old, brand: { ...old.brand, logoDescription: description } }])
      expect(
        (await client.query('SELECT app.global_header_defect($1::jsonb) AS defect', [JSON.stringify(content)])).rows[0]
          .defect,
      ).toBeNull()
    for (const invalid of ['', '  ', null, 'x'.repeat(301)])
      expect(
        (
          await client.query('SELECT app.global_header_defect($1::jsonb) AS defect', [
            JSON.stringify({ ...old, brand: { ...old.brand, logoDescription: invalid } }),
          ])
        ).rows[0].defect,
      ).toContain('description')
  })
  expect((await heads()).header_live).toEqual(current.header_live)
})
