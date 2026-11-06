import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SITE_FONT_REGISTRY } from '../src/content/site-assets.ts'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase,
  s: Scenario,
  defId: string,
  serial = 0
const digest = 'a'.repeat(64)
const identity = (site: string, name: string, hash = digest) => {
  const value = createHash('sha256').update(`cms-site-document:1:${site}:${hash}:${name}`).digest('hex')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`
}
const query = (actor: string | null, sql: string, args: unknown[] = []) => db.asUser(actor, c => c.query(sql, args))
const upload = async (name = `report-${++serial}.pdf`, site?: string, actor?: string | null) => {
  const destination = site ?? s.siteA,
    id = identity(destination, name)
  await query(actor === undefined ? s.contributorA : actor, 'SELECT app.upload_site_document($1,$2,$3,$4,$5)', [
    destination,
    id,
    99,
    digest,
    name,
  ])
  return id
}
const resolve = async (id: string, host = 'site-a.staging.example.test') =>
  (await db.as('public', c => c.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, id]))).rows
const fields = [
  { key: 'title', label: 'Title', required: true, type: 'text' },
  { key: 'document', label: 'Download PDF', required: false, type: 'url' },
  { key: 'unused', label: 'Unused PDF', required: false, type: 'url' },
  { key: 'body', label: 'Body', required: false, type: 'richtext' },
]
const presentation = { schemaVersion: 1, titleField: 'title', subtitleField: null, imageField: null, groupField: null }
async function collection() {
  const key = `documents-${++serial}`
  const row = (
    await query(s.superAdmin, 'SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
      s.siteA,
      key,
      key,
      key.replaceAll('-', '_'),
      JSON.stringify(fields),
      JSON.stringify(presentation),
    ])
  ).rows[0]!
  await query(s.superAdmin, 'SELECT * FROM app.publish_collection_schema($1,$2)', [row.collection_id, row.revision])
  return { id: row.collection_id as string, key: key.replaceAll('-', '_') }
}
const entry = (id: string | null, stableKey: string, document: string, extras: Record<string, string> = {}) => ({
  id,
  stableKey,
  values: { title: stableKey, document, ...extras },
})
const save = async (id: string, revision: number, entries: unknown[]) =>
  Number(
    (
      await query(s.contributorA, 'SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        id,
        revision,
        JSON.stringify(entries),
      ])
    ).rows[0]!.entry_revision,
  )
const publish = async (id: string, revision: number) =>
  Number(
    (await query(s.editorA, 'SELECT * FROM app.publish_collection_entries($1,$2)', [id, revision])).rows[0]!
      .entry_revision,
  )
const entries = async (id: string) =>
  (
    await query(s.editorA, 'SELECT id,stable_key FROM collection_entries WHERE collection_id=$1 ORDER BY sort_index', [
      id,
    ])
  ).rows
async function page(key: string, stableKeys: string[]) {
  const id = (
    await query(s.editorA, 'SELECT app.create_page($1,$2,$3) AS id', [s.siteA, `documents-${++serial}`, 'Documents'])
  ).rows[0]!.id
  const saved = (
    await query(s.editorA, 'SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify([
        {
          section_def_id: defId,
          section_def_version: 1,
          hidden: false,
          hidden_at: [],
          label: 'Documents',
          values: { documents: { readerKey: key, selection: { mode: 'manual', stableKeys } } },
        },
      ]),
      '{}',
    ])
  ).rows[0]!
  await query(s.editorA, 'SELECT app.publish_page($1,$2,$3,$4,$5)', [id, saved.revision, ...CHECKED_CLEAN])
  return id as string
}
beforeAll(async () => {
  db = await TestDatabase.create('documentuploads')
  s = await seedScenario(db)
  const doc = {
    schemaVersion: 3,
    fields: [{ name: 'documents', type: 'repeat', label: 'Documents' }],
    nodes: [
      {
        type: 'repeat',
        field: 'documents',
        empty: { behavior: 'message', text: 'No documents' },
        item: [
          {
            type: 'element',
            tag: 'article',
            children: [
              { type: 'text', field: 'title' },
              { type: 'link', field: 'document' },
              { type: 'richtext', field: 'body' },
            ],
          },
        ],
      },
    ],
  }
  defId = (
    await query(
      s.superAdmin,
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        'pdf-listing',
        'PDF listing',
        'Resources',
        '',
        '',
        '',
        JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
        JSON.stringify([{ id: 'documents', kind: 'repeat', label: 'Documents', constraints: {} }]),
        'pdf-listing-hash',
        4,
        6,
        'Synthetic PDF listing',
        false,
        'structured',
        JSON.stringify(doc),
        3,
      ],
    )
  ).rows[0]!.section_def_id
})
afterAll(async () => {
  await db?.close()
})

describe('editor-governed document receipts', () => {
  it('permits contributors, editors and site admins, but no outsiders, disabled or anonymous actors', async () => {
    for (const actor of [s.contributorA, s.editorA, s.superAdmin])
      expect(await upload(undefined, undefined, actor)).toMatch(/^[a-f0-9-]{36}$/)
    for (const actor of [s.editorB, s.disabled]) await expectSqlState(upload(undefined, undefined, actor), 'CMS02')
    await expectSqlState(upload(undefined, undefined, null), 'CMS02')
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, c => c.query('SELECT app.authorize_site_document_upload($1)', [s.siteA])),
        '42501',
      )
  })
  it('is idempotent, immutable, audited once and never grants raw object-key access', async () => {
    const name = `same-${++serial}.pdf`,
      id = await upload(name)
    expect(await upload(name)).toBe(id)
    expect(
      (
        await query(
          s.editorA,
          "SELECT count(*)::int AS n FROM audit_log WHERE action='document.upload' AND item_id=$1",
          [id],
        )
      ).rows[0]!.n,
    ).toBe(1)
    expect(
      (await query(s.editorA, 'SELECT provenance FROM site_assets WHERE id=$1', [id])).rows[0]!.provenance.path,
    ).toBe(`editor-uploads/${id}/${name}`)
    await expectSqlState(query(s.editorA, 'SELECT object_key FROM site_assets WHERE id=$1', [id]), '42501')
    await expectSqlState(query(s.editorA, 'DELETE FROM site_assets WHERE id=$1', [id]), '42501')
    await expectSqlState(
      query(s.editorA, 'SELECT app.upload_site_document($1,$2,$3,$4,$5)', [s.siteA, id, 100, digest, name]),
      'CMS04',
    )
  })
  it('validates receipt bounds, identity and PDF filename before insert', async () => {
    for (const [name, size, hash] of [
      ['bad.txt', 10, digest],
      ['../bad.pdf', 10, digest],
      ['bad.pdf', 0, digest],
      ['bad.pdf', 26214401, digest],
      ['bad.pdf', 10, 'bad'],
    ]) {
      const id = identity(s.siteA, String(name), String(hash))
      await expectSqlState(
        query(s.contributorA, 'SELECT app.upload_site_document($1,$2,$3,$4,$5)', [s.siteA, id, size, hash, name]),
        'CMS04',
      )
    }
    await expectSqlState(
      query(s.editorA, 'SELECT app.upload_site_document($1,$2,1,$3,$4)', [s.siteA, randomUUID(), digest, 'bad.pdf']),
      'CMS04',
    )
  })
  it('rejects archived site uploads including otherwise valid retries', async () => {
    const site = (
      await query(s.superAdmin, 'SELECT app.create_site($1,$2,$3,$4,$5,$6)', [
        `archived-${++serial}`,
        'Archived',
        'resource',
        `archived-${serial}.example.test`,
        JSON.stringify({
          colors: { primary: '#003087', surface: '#ffffff', ink: '#1a1a1a' },
          fonts: { heading: 'Georgia', body: 'system-ui' },
          radius: '0.5rem',
        }),
        '[]',
      ])
    ).rows[0]!.create_site
    await upload('before.pdf', site, s.superAdmin)
    const revision = (await query(s.superAdmin, 'SELECT revision FROM sites WHERE id=$1', [site])).rows[0]!.revision
    await query(s.superAdmin, 'SELECT app.archive_site($1,$2)', [site, revision])
    await expectSqlState(upload('before.pdf', site, s.superAdmin), 'CMS03')
  })
})

describe('collection document publication boundary', () => {
  it('validates every inserted entry version against the site and document kind', async () => {
    const c = await collection(),
      foreign = await upload('foreign.pdf', s.siteB, s.superAdmin),
      font = randomUUID(),
      registered = SITE_FONT_REGISTRY['trajan-regular']
    await query(s.superAdmin, 'SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
      s.siteA,
      font,
      'font',
      `site-assets/${s.siteA}/${font}/${registered.sha256}`,
      registered.mimeType,
      99,
      registered.sha256,
      registered.filename,
      'trajan-regular',
      JSON.stringify({ path: 'font/registered.otf', sha256: registered.sha256, manifest_sha256: digest }),
    ])
    for (const asset of [foreign, font, randomUUID(), 'not-an-id'])
      await expectSqlState(save(c.id, 0, [entry(null, 'invalid', `/assets/${asset}`)]), 'CMS04')
    const own = await upload()
    expect(await save(c.id, 0, [entry(null, 'valid', `/assets/${own}`)])).toBe(1)
  })
  it('preserves external resource URLs and plain-text asset mentions without making files public', async () => {
    const c = await collection(),
      asset = await upload()
    const external = `https://example.org/assets/${asset}`
    const externalNamed = 'https://example.org/assets/report.pdf'
    const content = [
      entry(null, 'external', external, {
        body: `<p>/assets/not-an-id</p><a href="${externalNamed}">External report</a>`,
      }),
    ]
    let revision = await save(c.id, 0, content)
    revision = await publish(c.id, revision)
    await page(c.key, ['external'])
    expect(await resolve(asset)).toEqual([])
  })
  it('requires a current selected published entry in a current live route; drafts and unused fields stay private', async () => {
    const c = await collection(),
      old = await upload(),
      next = await upload(),
      ignored = await upload(),
      unselected = await upload(),
      rich = await upload(),
      textOnly = await upload()
    let revision = await save(c.id, 0, [
      entry(null, 'selected', `/assets/${old}`, {
        unused: `/assets/${ignored}`,
        body: `<p>/assets/${textOnly}</p><a href="/assets/${rich}">Read</a>`,
      }),
      entry(null, 'unselected', `/assets/${unselected}`),
    ])
    expect(await resolve(old)).toEqual([])
    revision = await publish(c.id, revision)
    expect(await resolve(old)).toEqual([])
    const pageId = await page(c.key, ['selected']),
      rows = await entries(c.id)
    expect(await resolve(old)).toEqual([{ id: old }])
    expect(await resolve(rich)).toEqual([{ id: rich }])
    await query(s.contributorA, 'SELECT app.organize_site_document($1,$2,0,$3,true)', [s.siteA, old, 'Reports'])
    expect(await resolve(old)).toEqual([{ id: old }]) // Library retirement never revokes a live PDF link.

    for (const id of [ignored, unselected, textOnly, next]) expect(await resolve(id)).toEqual([])
    expect(await resolve(old, 'site-b.staging.example.test')).toEqual([])
    revision = await save(c.id, revision, [
      entry(rows[0]!.id, 'selected', `/assets/${next}`),
      entry(rows[1]!.id, 'unselected', `/assets/${unselected}`),
    ])
    expect(await resolve(old)).toEqual([{ id: old }])
    expect(await resolve(next)).toEqual([])
    revision = await publish(c.id, revision)
    expect(await resolve(old)).toEqual([])
    expect(await resolve(rich)).toEqual([])
    expect(await resolve(next)).toEqual([{ id: next }])
    const pageRevision = (await query(s.editorA, 'SELECT revision FROM pages WHERE id=$1', [pageId])).rows[0]!.revision
    await query(s.editorA, 'SELECT * FROM app.unpublish_page($1,$2)', [pageId, pageRevision])
    expect(await resolve(next)).toEqual([])
  })
  it('refuses raw-HTML replacement, hidden sections and invalid render-policy snapshots', async () => {
    const c = await collection(),
      asset = await upload()
    await publish(c.id, await save(c.id, 0, [entry(null, 'selected', `/assets/${asset}`)]))
    const pageId = await page(c.key, ['selected'])
    const original = (
      await db.as('owner', client =>
        client.query('SELECT render_manifest FROM published_routes WHERE page_id=$1', [pageId]),
      )
    ).rows[0]!.render_manifest
    for (const mutate of [
      (manifest: typeof original) => {
        manifest.sections[0].instance.raw_html = '<p>Replacement with no collection</p>'
      },
      (manifest: typeof original) => {
        manifest.sections[0].instance.hidden = true
      },
      (manifest: typeof original) => {
        manifest.sections[0].def.css_policy_version = 1
      },
    ]) {
      const current = structuredClone(original)
      mutate(current)
      await db.as('owner', client =>
        client.query('UPDATE published_routes SET render_manifest=$2 WHERE page_id=$1', [pageId, current]),
      )
      expect(await resolve(asset)).toEqual([])
    }
  })
  it('does not treat a stale route snapshot as permission for newly published entry content', async () => {
    const c = await collection(),
      old = await upload(),
      next = await upload()
    let revision = await publish(c.id, await save(c.id, 0, [entry(null, 'selected', `/assets/${old}`)]))
    const pageId = await page(c.key, ['selected']),
      row = (await entries(c.id))[0]!
    const stale = (
      await db.as('owner', client =>
        client.query('SELECT render_manifest FROM published_routes WHERE page_id=$1', [pageId]),
      )
    ).rows[0]!.render_manifest
    revision = await publish(c.id, await save(c.id, revision, [entry(row.id, 'selected', `/assets/${next}`)]))
    await db.as('owner', client =>
      client.query('UPDATE published_routes SET render_manifest=$2 WHERE page_id=$1', [pageId, stale]),
    )
    expect(await resolve(old)).toEqual([])
    expect(await resolve(next)).toEqual([])
  })
})

async function frameDefinition(asset: string) {
  const slug = `document-frame-${++serial}`
  const row = (
    await query(s.superAdmin, 'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      slug,
      'Document frame',
      'Frame',
      '<header>{{document}}{{body}}{{ignored}}</header>',
      '',
      '',
      JSON.stringify({
        policyVersion: 4,
        cssPolicyVersion: 6,
        nodes: [
          { kind: 'html', value: `<header><a href="/assets/${asset}">Static PDF</a>` },
          { kind: 'slot', slotId: 'document', slotKind: 'link', context: 'element-text' },
          { kind: 'slot', slotId: 'body', slotKind: 'richtext', context: 'element-text' },
          { kind: 'slot', slotId: 'ignored', slotKind: 'text', context: 'element-text' },
          { kind: 'html', value: '</header>' },
        ],
      }),
      JSON.stringify([
        { id: 'document', kind: 'link', label: 'Document', constraints: {} },
        { id: 'body', kind: 'richtext', label: 'Body', constraints: {} },
        { id: 'ignored', kind: 'text', label: 'Text', constraints: {} },
      ]),
      slug,
      4,
      6,
      'Synthetic document frame',
    ])
  ).rows[0]!
  await query(s.superAdmin, "SELECT app.set_section_def_placement($1,'header')", [row.section_def_id])
  return row
}
async function saveFrame(header: unknown, publishFrame = false) {
  return db.asUser(s.superAdmin, async client => {
    const heads = (
      await client.query(
        'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [s.siteA],
      )
    ).rows
    const h = heads.find(v => v.kind === 'header')!,
      f = heads.find(v => v.kind === 'footer')!
    const saved = (
      await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        s.siteA,
        h.revision,
        f.revision,
        JSON.stringify(header),
        JSON.stringify(f.content),
      ])
    ).rows[0]!
    if (publishFrame)
      await client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        s.siteA,
        saved.header_revision,
        saved.footer_revision,
      ])
  })
}
describe('authored-frame PDF delivery', () => {
  it('exposes only actual link sinks of the current published frame and revokes after disable', async () => {
    const stat = await upload(),
      linked = await upload(),
      rich = await upload(),
      ignored = await upload(),
      draft = await upload()
    const def = await frameDefinition(stat)
    const frame = {
      schemaVersion: 2,
      enabled: true,
      sticky: false,
      component: {
        section_def_id: def.section_def_id,
        section_def_version: def.version,
        values: {
          document: { url: `/assets/${linked}`, label: 'Download' },
          body: `<a href="/assets/${rich}">Read</a><img src="/assets/${ignored}">`,
          ignored: `/assets/${ignored}`,
        },
      },
    }
    await saveFrame(frame)
    expect(await resolve(stat)).toEqual([])
    await saveFrame(frame, true)
    for (const id of [stat, linked, rich]) expect(await resolve(id)).toEqual([{ id }])
    expect(await resolve(ignored)).toEqual([])
    await saveFrame({
      ...frame,
      component: {
        ...frame.component,
        values: { ...frame.component.values, document: { url: `/assets/${draft}`, label: 'Draft' } },
      },
    })
    expect(await resolve(linked)).toEqual([{ id: linked }])
    expect(await resolve(draft)).toEqual([])
    await saveFrame({ ...frame, enabled: false }, true)
    for (const id of [stat, linked, rich]) expect(await resolve(id)).toEqual([])
  })
  it('keeps new internal document/reference helpers inaccessible to ordinary roles', async () => {
    for (const role of ['public', 'authenticated'] as const) {
      await expectSqlState(
        db.as(role, c => c.query('SELECT app.published_frame_uses_site_document($1,$2)', [s.siteA, randomUUID()])),
        '42501',
      )
      await expectSqlState(
        db.as(role, c =>
          c.query('SELECT app.render_manifest_uses_collection_document($1,$2,$3,$4)', [
            '{}',
            randomUUID(),
            randomUUID(),
            randomUUID(),
          ]),
        ),
        '42501',
      )
    }
  })
})
