import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'

let db: TestDatabase, s: Scenario
let headerDef: string, footerDef: string
let defaultHeader: unknown, defaultFooter: unknown

async function definition(placement: 'header' | 'footer', html = '{{picture}}{{body}}', css = '') {
  const slug = `frame-media-${randomUUID().slice(0, 8)}`
  const ast = {
    policyVersion: 4,
    cssPolicyVersion: 6,
    nodes:
      html === '{{picture}}{{body}}'
        ? [
            { kind: 'slot', slotId: 'picture', slotKind: 'image', context: 'element-text' },
            { kind: 'slot', slotId: 'body', slotKind: 'richtext', context: 'element-text' },
          ]
        : [{ kind: 'html', value: html }],
  }
  return db.asUser(s.superAdmin, async client => {
    const row = (
      await client.query<{ section_def_id: string }>(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          slug,
          slug,
          'Frame',
          html,
          css,
          css ? `.cms-section--${slug}{${css}}` : '',
          JSON.stringify(ast),
          JSON.stringify([
            { id: 'picture', kind: 'image', label: 'Picture', constraints: {} },
            { id: 'body', kind: 'richtext', label: 'Body', constraints: {} },
          ]),
          `hash-${slug}`,
          4,
          6,
          'Fixture',
        ],
      )
    ).rows[0]!
    await client.query('SELECT app.set_section_def_placement($1,$2)', [row.section_def_id, placement])
    return row.section_def_id
  })
}

async function readyMedia(siteId: string | null = null) {
  const id = randomUUID()
  await db.as('owner', async client => {
    await client.query(
      `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status)
      VALUES($1,$2,$3,$4,'frame.jpg','Frame',10,10,100,'image/jpeg','ready')`,
      [id, siteId, `frame-lifecycle/${id}.jpg`, 'a'.repeat(64)],
    )
    await client.query(
      `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type)
      VALUES($1,'wide',$2,$3,10,10,80,'image/webp')`,
      [id, `frame-lifecycle/${id}.webp`, 'b'.repeat(64)],
    )
  })
  return id
}

function frame(
  kind: 'header' | 'footer',
  values: Record<string, unknown>,
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
  return db.asUser(s.superAdmin, async client => {
    const heads = (await client.query('SELECT kind,revision FROM global_elements WHERE site_id=$1', [s.siteA])).rows
    return (
      await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        s.siteA,
        heads.find(h => h.kind === 'header')!.revision,
        heads.find(h => h.kind === 'footer')!.revision,
        JSON.stringify(kind === 'header' ? content : defaultHeader),
        JSON.stringify(kind === 'footer' ? content : defaultFooter),
      ])
    ).rows[0]!
  })
}
async function publish(saved: { header_revision: string; footer_revision: string }) {
  return db.asUser(s.superAdmin, client =>
    client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
      s.siteA,
      saved.header_revision,
      saved.footer_revision,
    ]),
  )
}
const publicMedia = (id: string, host = 'site-a.staging.example.test') =>
  db.as(
    'public',
    async client =>
      (await client.query('SELECT media_id FROM public_api.resolve_media($1,$2,$3)', [host, id, 'wide'])).rows,
  )
const usages = (id: string) =>
  db.asUser(
    s.editorA,
    async client =>
      (
        await client.query(
          'SELECT item_type,item_id,version_id FROM media_usage WHERE media_id=$1 ORDER BY version_id',
          [id],
        )
      ).rows,
  )

beforeAll(async () => {
  db = await TestDatabase.create('frame-media-life')
  s = await seedScenario(db)
  const defaults = (
    await db.as('owner', client =>
      client.query(
        "SELECT app.default_header_content('Site A') AS header,app.default_footer_content('Site A') AS footer",
      ),
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

describe('authored-frame media readiness and retained usage', () => {
  it('keeps a missing-image draft repairable but refuses to publish it', async () => {
    const saved = await save(frame('header', { picture: { src: `/media/${randomUUID()}/wide`, alt: 'Missing' } }))
    expect(saved.header_version_id).toBeTruthy()
    await expectSqlState(publish(saved), 'CMS04')
  })

  it('refuses publication of a foreign image, including a src-only reference', async () => {
    const image = await readyMedia(s.siteB)
    const saved = await save(frame('header', { picture: { src: `/media/${image}/wide`, alt: 'Foreign' } }))
    await expectSqlState(publish(saved), 'CMS04')
    expect(await publicMedia(image)).toEqual([])
  })

  it('indexes a frame-only image in its immutable version', async () => {
    const image = await readyMedia()
    const saved = await save(frame('footer', { picture: { src: `/media/${image}/wide`, alt: 'Footer' } }), 'footer')
    expect(await usages(image)).toEqual([
      { item_type: 'global_element', item_id: expect.any(String), version_id: saved.footer_version_id },
    ])
  })

  it('refuses deletion of a live frame image without an explicit broken-reference decision', async () => {
    const image = await readyMedia()
    await publish(await save(frame('header', { picture: { src: `/media/${image}/wide`, alt: 'Header' } })))
    expect(await publicMedia(image)).toEqual([{ media_id: image }])
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('SELECT app.soft_delete_media($1,1,false,NULL)', [image])),
      'CMS04',
    )
  })

  it('rechecks deleted images and missing renditions at publication while keeping drafts repairable', async () => {
    const image = await readyMedia()
    const saved = await save(frame('header', { picture: { src: `/media/${image}/wide`, alt: 'Later removed' } }))
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.soft_delete_media($1,1,true,$2)', [image, 'Intentional synthetic deletion']),
    )
    await expectSqlState(publish(saved), 'CMS04')
    const deletedDraft = await save(frame('header', { picture: { src: `/media/${image}/wide`, alt: 'Repair this' } }))
    await expectSqlState(publish(deletedDraft), 'CMS04')
    const disabled = { ...frame('header', { picture: { src: `/media/${image}/wide` } }), enabled: false }
    await publish(await save(disabled))
    expect(await publicMedia(image)).toEqual([])

    const missingVariant = await readyMedia()
    const next = await save(
      frame('header', { picture: { src: `/media/${missingVariant}/thumbnail`, alt: 'Missing rendition' } }),
    )
    await expectSqlState(publish(next), 'CMS04')
    await publish(
      await save(frame('header', { picture: { src: `/media/${missingVariant}/original`, alt: 'Original exists' } })),
    )
  })

  it('retains historical uses while authorizing delivery only through the current published frame', async () => {
    const first = await readyMedia(),
      second = await readyMedia()
    await publish(await save(frame('header', { picture: `/media/${first}/wide` })))
    const draft = await save(frame('header', { picture: { src: `/media/${second}/wide`, alt: 'Replacement' } }))
    expect(await publicMedia(first)).toEqual([{ media_id: first }])
    expect(await publicMedia(second)).toEqual([])
    await publish(draft)
    expect(await publicMedia(first)).toEqual([])
    expect(await publicMedia(second)).toEqual([{ media_id: second }])
    expect(await publicMedia(second, 'site-b.staging.example.test')).toEqual([])
    expect((await usages(first)).length).toBeGreaterThan(0)
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('SELECT app.soft_delete_media($1,1,false,NULL)', [first])),
      'CMS04',
    )
  })

  it('checks actual static/CSS/rich-text sources without indexing inert mentions or ignored media metadata', async () => {
    const staticImage = await readyMedia(),
      cssImage = await readyMedia(),
      linkedImage = await readyMedia(),
      ignored = await readyMedia()
    const custom = await definition(
      'header',
      `<div><img src="/media/${staticImage}/wide"></div>`,
      `background-image:url('/media/${cssImage}/wide')`,
    )
    await publish(await save(frame('header', { unused: { src: `/media/${ignored}/wide`, media_id: ignored } }, custom)))
    expect((await usages(staticImage)).length).toBeGreaterThan(0)
    expect((await usages(cssImage)).length).toBeGreaterThan(0)
    expect(await usages(ignored)).toEqual([])
    const missingStatic = await definition('header', `<img src="/media/${randomUUID()}/wide">`)
    await expectSqlState(publish(await save(frame('header', {}, missingStatic))), 'CMS04')
    const missingCss = await definition(
      'header',
      '<div>Header</div>',
      `background-image:url('/media/${randomUUID()}/wide')`,
    )
    await expectSqlState(publish(await save(frame('header', {}, missingCss))), 'CMS04')

    await publish(
      await save(
        frame('header', {
          picture: { src: '/logo.svg', media_id: ignored },
          body: `<p>Inert /media/${ignored}/wide <a href="/media/${linkedImage}/wide">Download</a></p>`,
        }),
      ),
    )
    expect(await usages(ignored)).toEqual([])
    expect((await usages(linkedImage)).length).toBeGreaterThan(0)
  })

  it('backfills deleted historical references idempotently despite malformed sibling URLs', async () => {
    const image = await readyMedia()
    const content = frame('header', {
      picture: { src: `/media/${image}/wide`, alt: 'Retained' },
      body: '<p><a href="/media/not-an-id/wide">Needs repair</a></p>',
    })
    const saved = await save(content)
    await expectSqlState(publish(saved), 'CMS04')
    // Simulate a retained pre-migration version whose image was already
    // deleted. The migration's backfill calls this same command for each row.
    await db.as('owner', client => client.query('DELETE FROM media_usage WHERE media_id=$1', [image]))
    await db.asUser(s.superAdmin, client => client.query('SELECT app.soft_delete_media($1,1,false,NULL)', [image]))
    await db.as('owner', async client => {
      await client.query('SELECT app.index_global_element_version_media($1)', [saved.header_version_id])
      await client.query('SELECT app.index_global_element_version_media($1)', [saved.header_version_id])
      expect(
        (await client.query('SELECT content FROM global_element_versions WHERE id=$1', [saved.header_version_id]))
          .rows[0]!.content,
      ).toEqual(content)
    })
    expect(await usages(image)).toHaveLength(1)
  })

  it('counts and protects preset logos through the same immutable usage path', async () => {
    const image = await readyMedia()
    const header = defaultHeader as { brand: Record<string, unknown> }
    const saved = await save({ ...header, brand: { ...header.brand, logoMediaId: image } })
    expect(await usages(image)).toHaveLength(1)
    await publish(saved)
    expect(await publicMedia(image)).toEqual([{ media_id: image }])
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('SELECT app.soft_delete_media($1,1,false,NULL)', [image])),
      'CMS04',
    )
  })

  it('holds media readiness through the publication transaction', async () => {
    const image = await readyMedia()
    const saved = await save(frame('header', { picture: { src: `/media/${image}/wide`, alt: 'Publication lock' } }))
    await db.asUser(s.superAdmin, async client => {
      await client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        s.siteA,
        saved.header_revision,
        saved.footer_revision,
      ])
      await expectSqlState(
        db.asUser(s.superAdmin, async concurrent => {
          await concurrent.query("SET LOCAL lock_timeout='150ms'")
          await concurrent.query('SELECT app.soft_delete_media($1,1,true,$2)', [image, 'Concurrent explicit removal'])
        }),
        '55P03',
      )
    })
    expect(await publicMedia(image)).toEqual([{ media_id: image }])
  })

  it('keeps reference inspection and indexing inaccessible to application roles', async () => {
    for (const role of ['public', 'authenticated'] as const) {
      await expectSqlState(
        db.as(role, client =>
          client.query('SELECT app.frame_component_uses_url_pattern($1,$2,$3)', [{}, {}, '^/media/']),
        ),
        '42501',
      )
      await expectSqlState(
        db.as(role, client =>
          client.query("SELECT * FROM app.global_element_media_references($1,'header',$2)", [
            s.siteA,
            frame('header', {}),
          ]),
        ),
        '42501',
      )
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.index_global_element_version_media($1)', [randomUUID()])),
        '42501',
      )
    }
  })
})
