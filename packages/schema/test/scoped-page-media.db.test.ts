import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { compileSection } from '../../renderer/src/index.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase,
  s: Scenario,
  reader: string,
  otherReader: string,
  page: string,
  otherPage: string,
  chapter: string,
  own: string,
  foreign: string,
  unused: string
beforeAll(async () => {
  db = await TestDatabase.create('scoped_page_media')
  s = await seedScenario(db)
  const image = async () => {
    const id = randomUUID()
    await db.as('owner', async c => {
      await c.query(
        "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'Photo.jpg','Sample photo',10,10,100,'image/jpeg','ready')",
        [id, s.siteA, 'scope/' + id, id.replaceAll('-', '').padEnd(64, 'a')],
      )
      await c.query(
        "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'card',$2,$3,10,10,80,'image/webp')",
        [id, 'scope/' + id + '-card', id.replaceAll('-', '').padEnd(64, 'b')],
      )
    })
    return id
  }
  own = await image()
  foreign = await image()
  unused = await image()
  await db.asUser(s.superAdmin, async c => {
    reader = (await c.query("SELECT app.provision_user('chapter-reader@example.test','[Chapter editor]') AS id"))
      .rows[0]!.id
    otherReader = (
      await c.query("SELECT app.provision_user('other-chapter-reader@example.test','[Other chapter editor]') AS id")
    ).rows[0]!.id
    const slug = 'scoped-photo',
      html = '<div>{{photo}}</div>',
      slots = [{ id: 'photo', kind: 'image' as const, label: 'Photo', constraints: {} }]
    const compiled = compileSection({ sourceHtml: html, slots, scopeSelector: '.cms-section--' + slug })
    expect(compiled.blocking).toEqual([])
    const def = (
      await c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
        slug,
        'Photo',
        'Tests',
        html,
        '',
        compiled.css,
        JSON.stringify(compiled.ast),
        JSON.stringify(slots),
        compiled.renderHash,
        4,
        6,
        'Scoped photo delivery',
      ])
    ).rows[0]!
    for (const [index, photo, user] of [
      [0, own, reader],
      [1, foreign, otherReader],
    ] as const) {
      const id = (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          'chapters/photo-' + index,
          '[Chapter ' + index + ']',
        ])
      ).rows[0]!.id
      const setup = {
        name: '[Chapter ' + index + ']',
        destination: 'page',
        pageId: id,
        externalUrl: null,
        updateMode: 'chapter-editors',
        contact: { name: '[Name]', role: '[Role]', email: 'chapter@example.test' },
        sections: {
          paragraph: false,
          social: false,
          socialFirst: false,
          events: true,
          board: false,
          photos: false,
          memberLogin: false,
        },
        boardDisplay: 'all',
      }
      const ch = (
        await c.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [s.siteA, 'photo-' + index, setup])
      ).rows[0]!.chapter_id
      await c.query("SELECT * FROM app.save_page_draft($1,0,$2,'{}')", [
        id,
        JSON.stringify([
          {
            section_def_id: def.section_def_id,
            section_def_version: def.version,
            values: {
              __cms_chapter_part: 'events',
              photo: { src: '/media/' + photo + '/card', media_id: photo, variant: 'card', alt: 'Sample photo' },
            },
            hidden: false,
            hidden_at: [],
          },
        ]),
      ])
      await c.query('SELECT app.assign_chapter_editor($1,$2,true)', [ch, user])
      if (index === 0) {
        page = id
        chapter = ch
      } else otherPage = id
    }
  })
})
afterAll(async () => {
  await db?.close()
})
const resolve = (user: string, id: string, variant = 'original') =>
  db.asUser(user, async c => (await c.query('SELECT media_id FROM app.resolve_media($1,$2)', [id, variant])).rows)
it('serves only the assigned page photos without whole-site or library visibility', async () => {
  expect(await resolve(reader, own)).toEqual([{ media_id: own }])
  expect(await resolve(reader, own, 'card')).toEqual([{ media_id: own }])
  expect(await resolve(reader, foreign)).toEqual([])
  expect(await resolve(reader, unused)).toEqual([])
  expect(await resolve(otherReader, own)).toEqual([])
  expect(await resolve(s.editorB, own)).toEqual([])
  expect((await db.asUser(reader, c => c.query('SELECT id FROM media'))).rows).toEqual([])
  expect((await db.asUser(reader, c => c.query('SELECT app.has_site_access($1) AS allowed', [s.siteA]))).rows).toEqual([
    { allowed: false },
  ])
  expect(
    (
      await db.as('public', c =>
        c.query("SELECT media_id FROM public_api.resolve_media('site-a.staging.example.test',$1,'card')", [own]),
      )
    ).rows,
  ).toEqual([])
  await expectSqlState(
    db.asUser(reader, c => c.query("SELECT * FROM app.resolve_media($1,'../original')", [own])),
    'CMS04',
  )
})
it('requires the usage version to belong to the authorized page and site', async () => {
  const version = (await db.as('owner', c => c.query('SELECT draft_version_id FROM pages WHERE id=$1', [otherPage])))
    .rows[0]!.draft_version_id
  await db.as('owner', c =>
    c.query("INSERT INTO media_usage(media_id,site_id,item_type,item_id,version_id) VALUES($1,$2,'page',$3,$4)", [
      unused,
      s.siteA,
      page,
      version,
    ]),
  )
  expect(await resolve(reader, unused)).toEqual([])
})
it('retains authorized history but revokes delivery when the page assignment is removed', async () => {
  await db.asUser(s.superAdmin, async c => {
    const row = (await c.query('SELECT revision FROM pages WHERE id=$1', [page])).rows[0]!
    await c.query("SELECT * FROM app.save_page_draft($1,$2,'[]','{}')", [page, row.revision])
  })
  expect(await resolve(reader, own)).toEqual([{ media_id: own }])
  await db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_editor($1,$2,false)', [chapter, reader]))
  expect(await resolve(reader, own)).toEqual([])
})
it('keeps readiness, deletion and active-account guards', async () => {
  await db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_editor($1,$2,true)', [chapter, reader]))
  await db.as('owner', c => c.query("UPDATE media SET status='processing' WHERE id=$1", [own]))
  expect(await resolve(reader, own)).toEqual([])
  await db.as('owner', c => c.query("UPDATE media SET status='deleted',deleted_at=now() WHERE id=$1", [own]))
  expect(await resolve(reader, own)).toEqual([])
  await db.as('owner', c => c.query("UPDATE media SET status='ready',deleted_at=NULL WHERE id=$1", [own]))
  await db.asUser(s.superAdmin, c => c.query("SELECT app.set_user_status($1,'disabled')", [reader]))
  await expectSqlState(resolve(reader, own), 'CMS02')
})
