import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SITE_FONT_REGISTRY } from '../src/content/site-assets.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'

let db: TestDatabase, s: Scenario, headerDef: string, footerDef: string
let defaultHeader: unknown, defaultFooter: unknown

async function document(site = s.siteA) {
  const name = `${randomUUID()}.pdf`,
    hash = 'a'.repeat(64)
  const digest = createHash('sha256').update(`cms-site-document:1:${site}:${hash}:${name}`).digest('hex')
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  await db.asUser(s.superAdmin, c => c.query('SELECT app.upload_site_document($1,$2,99,$3,$4)', [site, id, hash, name]))
  return id
}
async function font() {
  const id = randomUUID(),
    registered = SITE_FONT_REGISTRY['trajan-regular']
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,99,$6,$7,$8,$9)', [
      s.siteA,
      id,
      'font',
      `site-assets/${s.siteA}/${id}/${registered.sha256}`,
      registered.mimeType,
      registered.sha256,
      registered.filename,
      'trajan-regular',
      JSON.stringify({ path: 'font/registered.otf', sha256: registered.sha256, manifest_sha256: 'a'.repeat(64) }),
    ]),
  )
  return id
}
async function definition(kind: 'header' | 'footer', staticHtml?: string, structured = false) {
  const slug = `frame-documents-${randomUUID().slice(0, 8)}`
  const slots = [
    { id: 'document', kind: 'link', label: 'Document', constraints: {} },
    { id: 'body', kind: 'richtext', label: 'Body', constraints: {} },
    { id: 'ignored', kind: 'text', label: 'Text', constraints: {} },
  ]
  const ast = {
    policyVersion: 4,
    cssPolicyVersion: 6,
    nodes: structured
      ? []
      : staticHtml === undefined
        ? [
            { kind: 'slot', slotId: 'document', slotKind: 'link', context: 'element-text' },
            { kind: 'slot', slotId: 'body', slotKind: 'richtext', context: 'element-text' },
            { kind: 'slot', slotId: 'ignored', slotKind: 'text', context: 'element-text' },
          ]
        : [{ kind: 'html', value: staticHtml }],
  }
  const doc = {
    schemaVersion: 3,
    fields: slots.map(slot => ({ name: slot.id, type: slot.kind, label: slot.label })),
    nodes: [
      { type: 'link', field: 'document' },
      { type: 'richtext', field: 'body' },
      { type: 'text', field: 'ignored' },
    ],
  }
  return db.asUser(s.superAdmin, async c => {
    const row = (
      await c.query(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        [
          slug,
          slug,
          'Frame',
          staticHtml ?? '{{document}}{{body}}{{ignored}}',
          '',
          '',
          JSON.stringify(ast),
          JSON.stringify(slots),
          slug,
          4,
          6,
          'Synthetic document frame',
          false,
          structured ? 'structured' : 'legacy',
          structured ? JSON.stringify(doc) : null,
          structured ? 3 : null,
        ],
      )
    ).rows[0]!
    await c.query('SELECT app.set_section_def_placement($1,$2)', [row.section_def_id, kind])
    return row.section_def_id as string
  })
}
function frame(
  values: Record<string, unknown>,
  kind: 'header' | 'footer' = 'header',
  def = kind === 'header' ? headerDef : footerDef,
) {
  return {
    schemaVersion: 2,
    enabled: true,
    ...(kind === 'header' ? { sticky: false } : {}),
    component: { section_def_id: def, section_def_version: 1, values },
  }
}
async function save(content: unknown, kind: 'header' | 'footer' = 'header') {
  return db.asUser(s.superAdmin, async c => {
    const heads = (await c.query('SELECT kind,revision FROM global_elements WHERE site_id=$1', [s.siteA])).rows
    return (
      await c.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        s.siteA,
        heads.find(h => h.kind === 'header')!.revision,
        heads.find(h => h.kind === 'footer')!.revision,
        JSON.stringify(kind === 'header' ? content : defaultHeader),
        JSON.stringify(kind === 'footer' ? content : defaultFooter),
      ])
    ).rows[0]!
  })
}
const publish = (saved: { header_revision: string; footer_revision: string }) =>
  db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
      s.siteA,
      saved.header_revision,
      saved.footer_revision,
    ]),
  )
const resolve = (id: string, host = 'site-a.staging.example.test') =>
  db.as('public', async c => (await c.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, id])).rows)

beforeAll(async () => {
  db = await TestDatabase.create('frame-document-ready')
  s = await seedScenario(db)
  const defaults = (
    await db.as('owner', c =>
      c.query("SELECT app.default_header_content('Site A') AS header,app.default_footer_content('Site A') AS footer"),
    )
  ).rows[0]!
  defaultHeader = defaults.header
  defaultFooter = defaults.footer
  headerDef = await definition('header')
  footerDef = await definition('footer')
})
afterAll(async () => {
  await db?.close()
})

describe('authored-frame document publication readiness', () => {
  it.each(['missing', 'foreign', 'font', 'malformed'] as const)(
    'retains a repairable %s-document draft and refuses publication',
    async defect => {
      const id =
        defect === 'missing'
          ? randomUUID()
          : defect === 'foreign'
            ? await document(s.siteB)
            : defect === 'font'
              ? await font()
              : 'not-an-id'
      const saved = await save(frame({ document: { url: `/assets/${id}`, label: 'Download' } }))
      expect(saved.header_version_id).toBeTruthy()
      await expectSqlState(publish(saved), 'CMS04')
      if (defect !== 'malformed') expect(await resolve(id)).toEqual([])
    },
  )

  it('checks static and rich-text link sinks using the same rules as delivery', async () => {
    const badStatic = await definition('header', '<a href=/assets/not-an-id>Download</a>')
    await expectSqlState(publish(await save(frame({}, 'header', badStatic))), 'CMS04')
    await expectSqlState(publish(await save(frame({ body: `<a href="/assets/${randomUUID()}">Missing</a>` }))), 'CMS04')
    const stat = await document(),
      rich = await document()
    const goodStatic = await definition('header', `<a href="/assets/${stat}?download=1#page=2">Download</a>`)
    await publish(await save(frame({}, 'header', goodStatic)))
    expect(await resolve(stat)).toEqual([{ id: stat }])
    await publish(await save(frame({ body: `<a href="/assets/${rich}">Read</a>` })))
    expect(await resolve(rich)).toEqual([{ id: rich }])
    expect(await resolve(stat)).toEqual([])
  })

  it('checks structured footer links and keeps draft files and other hosts private', async () => {
    const def = await definition('footer', undefined, true),
      old = await document(),
      next = await document()
    await expectSqlState(
      publish(
        await save(frame({ document: { url: `/assets/${randomUUID()}`, label: 'Missing' } }, 'footer', def), 'footer'),
      ),
      'CMS04',
    )
    await publish(
      await save(frame({ document: { url: `/assets/${old}`, label: 'Download' } }, 'footer', def), 'footer'),
    )
    const draft = await save(frame({ document: { url: `/assets/${next}`, label: 'Draft' } }, 'footer', def), 'footer')
    expect(await resolve(old)).toEqual([{ id: old }])
    expect(await resolve(next)).toEqual([])
    expect(await resolve(old, 'site-b.staging.example.test')).toEqual([])
    await publish(draft)
    expect(await resolve(old)).toEqual([])
    expect(await resolve(next)).toEqual([{ id: next }])
  })

  it('ignores external URLs, text, image sources, comments and unused metadata', async () => {
    await publish(
      await save(
        frame({
          document: { url: 'https://example.org/assets/not-an-id', label: 'External' },
          body: '<p>/assets/not-an-id</p><img src="/assets/not-an-id">',
          ignored: '/assets/not-an-id',
          unused: { url: '/assets/not-an-id', asset_id: randomUUID() },
        }),
      ),
    )
    const inert = await definition(
      'header',
      '<!-- <a href="/assets/not-an-id">Hidden</a> --><img src="/assets/not-an-id"><p>/assets/not-an-id</p>',
    )
    await publish(await save(frame({}, 'header', inert)))
  })

  it('permits disabling and repairing a broken frame without changing retained content', async () => {
    const broken = frame({ document: { url: `/assets/${randomUUID()}`, label: 'Needs repair' } })
    const original = await save(broken)
    await publish(await save({ ...broken, enabled: false }))
    const id = await document()
    await publish(await save(frame({ document: { url: `/assets/${id}`, label: 'Repaired' } })))
    expect(await resolve(id)).toEqual([{ id }])
    expect(
      (
        await db.as('owner', c =>
          c.query('SELECT content FROM global_element_versions WHERE id=$1', [original.header_version_id]),
        )
      ).rows[0]!.content,
    ).toEqual(broken)
  })

  it('keeps the composed readiness checks private to governed commands', async () => {
    for (const role of ['public', 'authenticated', 'worker'] as const) {
      for (const fn of ['global_elements_readiness_defect', 'global_elements_readiness_before_frame_documents']) {
        await expectSqlState(
          db.as(role, c => c.query(`SELECT app.${fn}($1,'header',$2)`, [s.siteA, frame({})])),
          '42501',
        )
      }
    }
  })
})
