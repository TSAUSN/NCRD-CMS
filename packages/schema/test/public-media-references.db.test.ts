import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileSection, renderSection } from '../../renderer/src/index.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { CHECKED_CLEAN, expectSqlState, TestDatabase } from './harness.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('public_media_refs')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function media(site: string | null = s.siteA) {
  const id = randomUUID()
  await db.as('owner', async c => {
    await c.query(
      `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status)
      VALUES($1,$2,$3,$4,'Private.jpg','Picture',10,10,100,'image/jpeg','ready')`,
      [id, site, `refs/${id}.jpg`, id.replaceAll('-', '').padEnd(64, 'a')],
    )
    for (const kind of ['card', 'wide'])
      await c.query(
        `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type)
      VALUES($1,$2,$3,$4,10,10,80,'image/webp')`,
        [id, kind, `refs/${id}-${kind}.webp`, id.replaceAll('-', '').padEnd(64, 'b')],
      )
  })
  return id
}
const resolve = (id: string, variant = 'wide', host = 'site-a.staging.example.test') =>
  db.as(
    'public',
    async c => (await c.query('SELECT media_id FROM public_api.resolve_media($1,$2,$3)', [host, id, variant])).rows,
  )
async function fixture(html: string, values: Record<string, unknown> = {}, css = '') {
  const slug = `refs-${randomUUID().slice(0, 8)}`
  const slots = [
    { id: 'photo', kind: 'image' as const, label: 'Photo', constraints: {} },
    { id: 'body', kind: 'richtext' as const, label: 'Body', constraints: {} },
  ]
  const compiled = compileSection({ sourceHtml: html, sourceCss: css, slots, scopeSelector: `.cms-section--${slug}` })
  expect(compiled.blocking).toEqual([])
  const def = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          slug,
          slug,
          'Tests',
          html,
          css,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          6,
          'Rendered media regression',
        ])
      ).rows[0]!,
  )
  const page = await db.asUser(
    s.editorA,
    async c => (await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, slug])).rows[0]!.id,
  )
  const content = [
    {
      section_def_id: def.section_def_id,
      section_def_version: def.version,
      values,
      hidden: false,
      hidden_at: [],
      label: 'Test',
    },
  ]
  async function save(publish = true) {
    return db.asUser(s.editorA, async c => {
      const head = (await c.query('SELECT revision FROM pages WHERE id=$1', [page])).rows[0]!
      const saved = (
        await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          page,
          head.revision,
          JSON.stringify(content),
          '{}',
        ])
      ).rows[0]!
      if (publish) await c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, saved.revision, ...CHECKED_CLEAN])
      return saved
    })
  }
  return { page, slug, content, save }
}
// LIB-02: a repeated item's picture is a rendered sink while its item is on
// the published page, and only then; the database expands items as the renderer does.
async function repeatFixture(values: Record<string, unknown>) {
  const slug = `items-${randomUUID().slice(0, 8)}`
  const slots = [
    {
      id: 'cards',
      kind: 'repeat' as const,
      label: 'Cards',
      constraints: {
        item: {
          unit: 'Card',
          max: 3,
          fields: [
            { id: 'photo', kind: 'image', label: 'Photo' },
            { id: 'title', kind: 'text', label: 'Title' },
          ],
        },
      },
    },
  ]
  const html =
    '<div class="grid">{{#cards}}<article><img src="{{photo}}" alt="{{photo}}"><h3>{{title}}</h3></article>{{/cards}}</div>'
  const compiled = compileSection({ sourceHtml: html, slots, scopeSelector: `.cms-section--${slug}` })
  expect(compiled.blocking).toEqual([])
  const def = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          slug,
          slug,
          'Tests',
          html,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          6,
          'Repeated items',
        ])
      ).rows[0]!,
  )
  const page = await db.asUser(
    s.editorA,
    async c => (await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, slug])).rows[0]!.id,
  )
  const content = [
    {
      section_def_id: def.section_def_id,
      section_def_version: def.version,
      values,
      hidden: false,
      hidden_at: [],
      label: 'Cards',
    },
  ]
  const save = () =>
    db.asUser(s.editorA, async c => {
      const head = (await c.query('SELECT revision FROM pages WHERE id=$1', [page])).rows[0]!
      const saved = (
        await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          page,
          head.revision,
          JSON.stringify(content),
          '{}',
        ])
      ).rows[0]!
      await c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, saved.revision, ...CHECKED_CLEAN])
    })
  return { slug, content, save }
}
describe('repeated items on a published page', () => {
  it('serves an item’s picture while the item is listed, in any position, and not once it is removed or past the limit', async () => {
    const [first, second, removed, beyond] = await Promise.all([media(), media(), media(), media()])
    const picture = (id: string) => ({ src: `/media/${id}/wide`, media_id: id, variant: 'wide', alt: 'Picture' })
    const f = await repeatFixture({
      cards: { items: ['i2', 'i1'] },
      cards__i1__photo: picture(first!),
      cards__i2__photo: picture(second!),
      // A value left behind by a removed item, and a fourth item past the declared limit of three.
      cards__i9__photo: picture(removed!),
      cards__i3__title: 'Third',
    })
    await f.save()
    expect(await resolve(first!)).toEqual([{ media_id: first }])
    expect(await resolve(second!)).toEqual([{ media_id: second }])
    expect(await resolve(removed!)).toEqual([])
    f.content[0]!.values = {
      ...f.content[0]!.values,
      cards: { items: ['i1', 'i2', 'i3', 'i4'] },
      cards__i4__photo: picture(beyond!),
    }
    await f.save()
    expect(await resolve(beyond!)).toEqual([])
    const manifest = (
      await db.as('public', c =>
        c.query('SELECT render_manifest FROM public_api.resolve_route($1,$2)', [
          'site-a.staging.example.test',
          `/${f.slug}`,
        ]),
      )
    ).rows[0]!.render_manifest
    const html = renderSection(manifest.sections[0], 0)
    expect(html).toContain(`/media/${first}/wide`)
    expect(html).not.toContain(`/media/${beyond}/wide`)
    f.content[0]!.values = { ...f.content[0]!.values, cards: { items: ['i2'] } }
    await f.save()
    expect(await resolve(first!)).toEqual([])
    expect(await resolve(second!)).toEqual([{ media_id: second }])
  })
})
describe('anonymous image delivery follows actual published sinks', () => {
  it('keeps unreferenced ready uploads private on an existing public site while members can inspect them', async () => {
    const id = await media()
    expect(await resolve(id)).toEqual([])
    expect(
      (await db.asUser(s.editorA, c => c.query("SELECT media_id FROM app.resolve_media($1,'original')", [id]))).rows,
    ).toEqual([{ media_id: id }])
    await expectSqlState(
      db.as('public', c => c.query("SELECT app.render_manifest_uses_media_url('{}','.*')")),
      '42501',
    )
  })
  it('requires actual publication and the exact rendition; later drafts/history do not grant or revoke access', async () => {
    const id = await media(),
      next = await media()
    const f = await fixture('<div>{{photo}}</div>', {
      photo: { src: `/media/${id}/wide`, media_id: id, variant: 'wide', alt: 'Picture' },
    })
    await f.save(false)
    expect(await resolve(id)).toEqual([])
    await f.save()
    expect(await resolve(id)).toEqual([{ media_id: id }])
    expect(await resolve(id, 'original')).toEqual([])
    expect(await resolve(id, 'card')).toEqual([])
    f.content[0]!.values.photo = { src: `/media/${next}/wide`, media_id: next, variant: 'wide', alt: 'Next' }
    await f.save(false)
    expect(await resolve(next)).toEqual([])
    expect(await resolve(id)).toEqual([{ media_id: id }])
    await f.save()
    expect(await resolve(next)).toEqual([{ media_id: next }])
    expect(await resolve(id)).toEqual([])
    const manifest = (
      await db.as('public', c =>
        c.query('SELECT render_manifest FROM public_api.resolve_route($1,$2)', [
          'site-a.staging.example.test',
          `/${f.slug}`,
        ]),
      )
    ).rows[0]!.render_manifest
    expect(renderSection(manifest.sections[0], 0)).toContain(`/media/${next}/wide`)
  })
  it('does not treat unused fields, text mentions, comments or stripped rich-text images as publication', async () => {
    const [unused, text, stripped] = await Promise.all([media(), media(), media()])
    const f = await fixture(`<p>/media/${text}/wide</p><!-- <img src="/media/${text}/wide"> -->{{body}}`, {
      photo: { src: `/media/${unused}/wide`, media_id: unused, variant: 'wide', alt: 'Unused' },
      body: `<p><img src="/media/${stripped}/wide"></p>`,
    })
    await f.save()
    for (const id of [unused, text, stripped]) expect(await resolve(id!)).toEqual([])
  })
  it('permits pinned static markup, CSS and rich-text links without exposing foreign media', async () => {
    const [staticId, cssId, linked, foreign] = await Promise.all([media(null), media(null), media(), media(s.siteB)])
    const f = await fixture(
      `<div class="banner"><img src="/media/${staticId}/wide" alt="Static">{{body}}</div>`,
      { body: `<p><a href="/media/${linked}/original">Original</a></p>` },
      `.banner{background-image:url('/media/${cssId}/card')}`,
    )
    await f.save()
    expect(await resolve(staticId!)).toEqual([{ media_id: staticId }])
    expect(await resolve(cssId!, 'card')).toEqual([{ media_id: cssId }])
    expect(await resolve(linked!, 'original')).toEqual([{ media_id: linked }])
    expect(await resolve(foreign!)).toEqual([])
    expect(await resolve(staticId!, 'wide', 'site-b.staging.example.test')).toEqual([])
  })
  it('globally hiding or unpublishing the only reference revokes public delivery while membership retains history access', async () => {
    const id = await media(),
      f = await fixture('<div>{{photo}}</div>', { photo: { src: `/media/${id}/wide`, alt: 'Picture' } })
    await f.save()
    expect(await resolve(id)).toEqual([{ media_id: id }])
    f.content[0]!.hidden = true
    await f.save()
    expect(await resolve(id)).toEqual([])
    f.content[0]!.hidden = false
    const saved = await f.save()
    await db.asUser(s.editorA, c => c.query('SELECT app.unpublish_page($1,$2)', [f.page, Number(saved.revision) + 1]))
    expect(await resolve(id)).toEqual([])
    expect(
      (await db.asUser(s.editorA, c => c.query("SELECT media_id FROM app.resolve_media($1,'wide')", [id]))).rows,
    ).toEqual([{ media_id: id }])
  })
})

it('checks a likely rendered media reference before unrelated routes and sections without bypassing sink validation', async () => {
  const id = await media(null)
  const other = await fixture('<p>Unrelated published content</p>')
  const selected = await fixture('<img src="{{photo}}" alt="{{photo}}">', {
    photo: { src: `/media/${id}/wide`, alt: 'Selected review image', decorative: false },
  })
  selected.content.unshift(structuredClone(other.content[0]!))
  await selected.save()
  await db.as('owner', async c => {
    await c.query('BEGIN')
    try {
      for (const [name, signature, args, parameters, sequence] of [
        [
          'render_manifest_uses_media_url',
          'jsonb,text',
          'p_manifest,p_pattern',
          'p_manifest jsonb,p_pattern text',
          'qa_route_checks',
        ],
        [
          'page_component_uses_url_pattern',
          'jsonb,jsonb,text',
          'p_component,p_values,p_pattern',
          'p_component jsonb,p_values jsonb,p_pattern text',
          'qa_section_checks',
        ],
      ]) {
        const definition = (
          await c.query<{ definition: string }>('SELECT pg_get_functiondef($1::regprocedure) AS definition', [
            'app.' + name + '(' + signature + ')',
          ])
        ).rows[0]!.definition
        await c.query(definition.replace('FUNCTION app.' + name + '(', 'FUNCTION app.qa_original_' + name + '('))
        await c.query('CREATE SEQUENCE public.' + sequence)
        await c.query('ALTER SEQUENCE public.' + sequence + ' OWNER TO cms_migration_owner')
        await c.query(`CREATE OR REPLACE FUNCTION app.${name}(${parameters}) RETURNS boolean
          LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $wrapped$
          BEGIN PERFORM nextval('public.${sequence}');
            RETURN app.qa_original_${name}(${args}); END $wrapped$`)
      }
      const result = await c.query("SELECT media_id FROM public_api.resolve_media($1,$2,'wide')", [
        'site-a.staging.example.test',
        id,
      ])
      expect(result.rows).toEqual([{ media_id: id }])
      expect((await c.query('SELECT last_value::int AS calls FROM public.qa_route_checks')).rows).toEqual([
        { calls: 1 },
      ])
      expect((await c.query('SELECT last_value::int AS calls FROM public.qa_section_checks')).rows).toEqual([
        { calls: 1 },
      ])
    } finally {
      // Instrumentation is local to this disposable database transaction.
      await c.query('ROLLBACK')
    }
  })
})
