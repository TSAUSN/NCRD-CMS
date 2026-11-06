import { createHash, randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_THEME_TOKENS, SITE_FONT_REGISTRY } from '@cms/schema'
import { compileSection, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION } from '@cms/renderer'
import { evaluateVersionReadiness, evaluateVersionsReadiness } from '../src/publication.ts'
import { ScratchDatabase } from './database.ts'

let db: ScratchDatabase, owner: Pool, member: Pool, worker: Pool, visitor: Pool
const root = randomUUID(),
  outsider = randomUUID()
let site: string, foreign: string, pdf: string, foreignPdf: string, font: string
const host = 'pdf-readiness.staging.test'

async function asMember<T>(user: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await member.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [user])
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
const asRoot = <T>(run: (client: PoolClient) => Promise<T>) => asMember(root, run)
async function document(siteId: string) {
  const name = `${randomUUID()}.pdf`,
    hash = 'a'.repeat(64)
  const digest = createHash('sha256').update(`cms-site-document:1:${siteId}:${hash}:${name}`).digest('hex')
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  await asRoot(client => client.query('SELECT app.upload_site_document($1,$2,99,$3,$4)', [siteId, id, hash, name]))
  return id
}
async function definition(
  html: string,
  slots: { id: string; kind: 'text' | 'link'; label: string; constraints: Record<string, never> }[] = [],
) {
  const slug = `pdf-${randomUUID().slice(0, 8)}`
  const compiled = compileSection({ sourceHtml: html, sourceCss: '', slots, scopeSelector: `.cms-section--${slug}` })
  expect(compiled.blocking).toEqual([])
  return asRoot(
    async client =>
      (
        await client.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          slug,
          slug,
          'Documents',
          html,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          SANITIZER_POLICY_VERSION,
          CSS_POLICY_VERSION,
          'Document readiness fixture',
        ])
      ).rows[0]!.section_def_id as string,
  )
}
async function page(
  definitionId: string,
  values: Record<string, unknown> = {},
  slug = `pdf-${randomUUID().slice(0, 8)}`,
) {
  return asRoot(async client => {
    const id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, 'Document page'])).rows[0]!.id
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify([
          {
            section_def_id: definitionId,
            section_def_version: 1,
            values,
            hidden: false,
            hidden_at: [],
            label: 'Document',
          },
        ]),
        JSON.stringify({ description: 'A document readiness test.' }),
      ])
    ).rows[0]!
    return { id, version: saved.version_id as string, revision: saved.revision }
  })
}
async function reports(version: string) {
  const memberReport = await asRoot(client => evaluateVersionReadiness(client, version, 'member'))
  const workerReport = await evaluateVersionReadiness(worker, version, 'worker')
  expect(workerReport).toEqual(memberReport)
  return memberReport
}

beforeAll(async () => {
  db = await ScratchDatabase.create('document_readiness')
  owner = db.pool()
  function login(user: string) {
    const url = new URL(db.url)
    url.username = user
    url.password = 'devpassword'
    return new Pool({ connectionString: url.toString() })
  }
  member = login('cms_admin_app')
  worker = login('cms_worker_app')
  visitor = login('cms_site_app')
  await owner.query(
    "INSERT INTO app_users(id,email,display_name) VALUES($1,'pdf-root@example.test','Root'),($2,'pdf-outsider@example.test','Outsider')",
    [root, outsider],
  )
  await owner.query("INSERT INTO global_roles(user_id,role) VALUES($1,'super_admin')", [root])
  await asRoot(async client => {
    for (const [slug, hostname] of [
      ['pdf-readiness', host],
      ['pdf-foreign', 'pdf-foreign.staging.test'],
    ]) {
      const id = (
        await client.query("SELECT app.create_site($1,$1,'resource',$2,$3,'[]') AS id", [
          slug,
          hostname,
          JSON.stringify(DEFAULT_THEME_TOKENS),
        ])
      ).rows[0]!.id
      if (slug === 'pdf-readiness') site = id
      else foreign = id
      await client.query('SELECT app.publish_theme($1,1)', [id])
      await client.query('SELECT app.publish_navigation($1,1)', [id])
      await client.query('SELECT app.publish_global_elements($1,1,1)', [id])
    }
  })
  pdf = await document(site)
  foreignPdf = await document(foreign)
  font = randomUUID()
  const registered = SITE_FONT_REGISTRY['trajan-regular']
  await asRoot(client =>
    client.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,99,$6,$7,$8,$9)', [
      site,
      font,
      'font',
      `site-assets/${site}/${font}/${registered.sha256}`,
      registered.mimeType,
      registered.sha256,
      registered.filename,
      'trajan-regular',
      JSON.stringify({ path: 'font/registered.otf', sha256: registered.sha256, manifest_sha256: 'a'.repeat(64) }),
    ]),
  )
  // The default frame links home. Publish that real destination so document
  // cases measure PDFs rather than an unrelated missing home-page finding.
  const home = await page(await definition('<h1>Document library</h1>'), {}, '')
  const report = await reports(home.version)
  expect(report.ok).toBe(true)
  await asRoot(client =>
    client.query('SELECT app.publish_page($1,$2,$3,NULL,$4)', [
      home.id,
      home.revision,
      report.policyVersion,
      JSON.stringify(report.findings),
    ]),
  )
}, 60_000)
afterAll(async () => {
  await Promise.all([member?.end(), worker?.end(), visitor?.end()])
  await db?.close()
})

describe('governed PDF link readiness', () => {
  it('accepts a candidate page PDF with query/fragment and serves it after normal publication', async () => {
    const def = await definition('<h1>Read the report</h1>{{document}}', [
      { id: 'document', kind: 'link', label: 'Document', constraints: {} },
    ])
    const saved = await page(def, { document: { url: `/assets/${pdf}?download=1#page=2`, label: 'Read report' } })
    expect((await visitor.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, pdf])).rows).toEqual([])
    const report = await reports(saved.version)
    expect(report.ok).toBe(true)
    await asRoot(client =>
      client.query('SELECT app.publish_page($1,$2,$3,NULL,$4)', [
        saved.id,
        saved.revision,
        report.policyVersion,
        JSON.stringify(report.findings),
      ]),
    )
    expect((await visitor.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, pdf])).rows).toEqual([
      { id: pdf },
    ])
  })

  it.each(['missing', 'foreign', 'font', 'malformed'] as const)(
    'refuses a %s document-looking link for both callers',
    async kind => {
      const id =
        kind === 'missing' ? randomUUID() : kind === 'foreign' ? foreignPdf : kind === 'font' ? font : 'not-a-uuid'
      // Static definition markup becomes usage only for an existing same-site
      // document (migration 0100). Each of these targets stays renderable but unserved.
      const saved = await page(await definition(`<h1>Document</h1><a href="/assets/${id}">Read report</a>`))
      const report = await reports(saved.version)
      expect(report.blocking.map(finding => finding.rule)).toEqual(['broken_internal_link'])
    },
  )

  it('accepts a same-site PDF linked from pinned definition markup and serves it only after publication', async () => {
    const own = await document(site)
    const saved = await page(await definition(`<h1>Document</h1><a href="/assets/${own}">Read report</a>`))
    expect(
      (await owner.query('SELECT asset_id FROM site_asset_usage WHERE version_id=$1', [saved.version])).rows,
    ).toEqual([{ asset_id: own }])
    expect((await visitor.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, own])).rows).toEqual([])
    const report = await reports(saved.version)
    expect(report.ok).toBe(true)
    await asRoot(client =>
      client.query('SELECT app.publish_page($1,$2,$3,NULL,$4)', [
        saved.id,
        saved.revision,
        report.policyVersion,
        JSON.stringify(report.findings),
      ]),
    )
    expect((await visitor.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, own])).rows).toEqual([
      { id: own },
    ])
  })

  it('accepts the exact published frame PDF while the candidate itself has no asset usage', async () => {
    const framePdf = await document(site)
    const def = await definition(`<a href="/assets/${framePdf}#page=3">Frame report</a>`)
    await asRoot(async client => {
      await client.query("SELECT app.set_section_def_placement($1,'header')", [def])
      const heads = (
        await client.query(
          'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
          [site],
        )
      ).rows
      const header = {
        schemaVersion: 2,
        enabled: true,
        sticky: false,
        component: { section_def_id: def, section_def_version: 1, values: {} },
      }
      const saved = (
        await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
          site,
          heads.find(h => h.kind === 'header')!.revision,
          heads.find(h => h.kind === 'footer')!.revision,
          JSON.stringify(header),
          JSON.stringify(heads.find(h => h.kind === 'footer')!.content),
        ])
      ).rows[0]!
      await client.query('SELECT app.publish_global_elements($1,$2,$3)', [
        site,
        saved.header_revision,
        saved.footer_revision,
      ])
    })
    const saved = await page(await definition('<h1>Page with a shared frame</h1>'))
    expect(
      (await owner.query('SELECT asset_id FROM site_asset_usage WHERE version_id=$1', [saved.version])).rows,
    ).toEqual([])
    expect((await reports(saved.version)).ok).toBe(true)
  })

  it('accepts a selected collection PDF before its candidate route exists and excludes unused records', async () => {
    const selected = await document(site),
      unused = await document(site),
      unselected = await document(site)
    const def = await asRoot(async client => {
      const fields = [
        { key: 'title', label: 'Title', required: true, type: 'text' },
        { key: 'document', label: 'PDF', required: false, type: 'url' },
        { key: 'unused', label: 'Unused', required: false, type: 'url' },
      ]
      const collection = (
        await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          site,
          'documents',
          'Documents',
          'documents',
          JSON.stringify(fields),
          JSON.stringify({
            schemaVersion: 1,
            titleField: 'title',
            subtitleField: null,
            imageField: null,
            groupField: null,
          }),
        ])
      ).rows[0]!
      await client.query('SELECT app.publish_collection_schema($1,$2)', [collection.collection_id, collection.revision])
      const records = [
        {
          id: null,
          stableKey: 'selected',
          values: { title: 'Selected', document: `/assets/${selected}`, unused: `/assets/${unused}` },
        },
        { id: null, stableKey: 'unselected', values: { title: 'Unselected', document: `/assets/${unselected}` } },
      ]
      const saved = (
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
          collection.collection_id,
          JSON.stringify(records),
        ])
      ).rows[0]!
      await client.query('SELECT app.publish_collection_entries($1,$2)', [
        collection.collection_id,
        saved.entry_revision,
      ])
      const doc = {
        schemaVersion: 3,
        fields: [
          { name: 'heading', type: 'text', label: 'Heading' },
          { name: 'documents', type: 'repeat', label: 'Documents' },
        ],
        nodes: [
          { type: 'element', tag: 'h1', children: [{ type: 'text', field: 'heading' }] },
          {
            type: 'repeat',
            field: 'documents',
            empty: { behavior: 'message', text: 'No documents' },
            item: [
              { type: 'text', field: 'title' },
              { type: 'link', field: 'document' },
            ],
          },
        ],
      }
      return (
        await client.query(
          'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
          [
            'pdf-collection',
            'PDF collection',
            'Documents',
            '',
            '',
            '',
            JSON.stringify({
              nodes: [],
              policyVersion: SANITIZER_POLICY_VERSION,
              cssPolicyVersion: CSS_POLICY_VERSION,
            }),
            JSON.stringify([
              { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
              { id: 'documents', kind: 'repeat', label: 'Documents', constraints: {} },
            ]),
            'pdf-collection',
            SANITIZER_POLICY_VERSION,
            CSS_POLICY_VERSION,
            'PDF collection fixture',
            false,
            'structured',
            JSON.stringify(doc),
            3,
          ],
        )
      ).rows[0]!.section_def_id as string
    })
    const saved = await page(def, {
      heading: 'Documents',
      documents: { readerKey: 'documents', selection: { mode: 'manual', stableKeys: ['selected'] } },
    })
    expect(
      (await owner.query('SELECT asset_id FROM site_asset_usage WHERE version_id=$1', [saved.version])).rows,
    ).toEqual([])
    expect((await reports(saved.version)).ok).toBe(true)
    for (const query of [
      () =>
        asRoot(client =>
          client.query('SELECT path FROM app.readiness_document_paths($1,$2::uuid[])', [
            saved.version,
            [selected, unused, unselected],
          ]),
        ),
      () =>
        worker.query('SELECT path FROM app.readiness_document_paths_internal($1,$2::uuid[])', [
          saved.version,
          [selected, unused, unselected],
        ]),
    ]) {
      expect((await query()).rows).toEqual([{ path: `/assets/${selected}` }])
    }
  })

  it('keeps helper authority narrow: no public, anonymous member, outsider or member internal access', async () => {
    const saved = await page(await definition('<h1>Private candidate</h1>'))
    for (const name of ['readiness_document_paths', 'readiness_document_paths_internal']) {
      await expect(
        visitor.query(`SELECT * FROM app.${name}($1,$2::uuid[])`, [saved.version, [pdf]]),
      ).rejects.toMatchObject({ code: '42501' })
    }
    await expect(
      member.query('SELECT * FROM app.readiness_document_paths($1,$2::uuid[])', [saved.version, [pdf]]),
    ).rejects.toMatchObject({ code: 'CMS02' })
    await expect(
      asMember(outsider, client =>
        client.query('SELECT * FROM app.readiness_document_paths($1,$2::uuid[])', [saved.version, [pdf]]),
      ),
    ).rejects.toMatchObject({ code: 'CMS03' })
    await expect(
      asRoot(client =>
        client.query('SELECT * FROM app.readiness_document_paths_internal($1,$2::uuid[])', [saved.version, [pdf]]),
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(worker.query('SELECT id FROM public.site_assets LIMIT 1')).rejects.toMatchObject({ code: '42501' })
  })
})

describe("links to the site's own pictures", () => {
  async function picture(siteId: string, status: 'ready' | 'processing' = 'ready') {
    const id = randomUUID()
    await owner.query(
      `INSERT INTO media(id,site_id,object_key,content_hash,mime_type,status,width,height,bytes,alt_text)
      VALUES($1,$2,$3,$4,'image/png',$5,10,10,99,'A gallery picture')`,
      [id, siteId, `media/${id}`, 'b'.repeat(64), status],
    )
    return id
  }
  const linked = async (url: string) => {
    const def = await definition('<h1>Gallery</h1>{{photo}}', [
      { id: 'photo', kind: 'link', label: 'Photo', constraints: {} },
    ])
    return reports((await page(def, { photo: { url, label: 'See the full picture' } })).version)
  }

  it("accepts a link to one of the site's ready pictures (0111)", async () => {
    const report = await linked(`/media/${await picture(site)}/original`)
    expect(report.blocking).toEqual([])
  })

  it("still refuses another site's picture, an unfinished one and one that does not exist", async () => {
    for (const url of [
      `/media/${await picture(foreign)}/original`,
      `/media/${await picture(site, 'processing')}/original`,
      `/media/${randomUUID()}/original`,
    ]) {
      expect((await linked(url)).blocking.map(finding => finding.rule)).toEqual(['broken_internal_link'])
    }
  })
})

it('never reuses another identity’s batched readiness facts or document authority', async () => {
  const saved = await page(await definition('<h1>Scoped batch</h1><a href="/assets/' + pdf + '">Read PDF</a>'))
  const expected = await asRoot(client => evaluateVersionReadiness(client, saved.version, 'member'))
  expect(
    await asRoot(client => evaluateVersionsReadiness(client, [{ versionId: saved.version, access: 'member' }])),
  ).toEqual([expected])
  await expect(
    asMember(outsider, client => evaluateVersionsReadiness(client, [{ versionId: saved.version, access: 'member' }])),
  ).rejects.toMatchObject({ kind: 'not_found' })
  expect(await asRoot(client => evaluateVersionReadiness(client, saved.version, 'member'))).toEqual(expected)
})

it('keeps each site’s published paths separate inside one batch', async () => {
  const definitionId = await definition('<h1>Scoped paths</h1><a href="/">Home</a>')
  const local = await page(definitionId)
  await asRoot(async client => {
    const id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [foreign, 'batch-paths', 'Foreign paths']))
      .rows[0]!.id
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify([
          {
            section_def_id: definitionId,
            section_def_version: 1,
            values: {},
            hidden: false,
            hidden_at: [],
            label: 'Scoped paths',
          },
        ]),
        JSON.stringify({ description: 'Scoped paths fixture.' }),
      ])
    ).rows[0]!
    const versions = [local.version, saved.version_id as string]
    const expected = []
    for (const version of versions) expected.push(await evaluateVersionReadiness(client, version, 'member'))
    expect(expected[0]!.blocking).toEqual([])
    expect(expected[1]!.blocking.map(finding => finding.rule)).toContain('broken_internal_link')
    expect(
      await evaluateVersionsReadiness(
        client,
        versions.map(versionId => ({ versionId, access: 'member' })),
      ),
    ).toEqual(expected)
  })
})
