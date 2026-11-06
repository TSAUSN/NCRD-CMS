import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, heroContent, type Scenario } from '@cms/schema/fixtures'
vi.mock('server-only', () => ({}))
let db: TestDatabase, s: Scenario, from: string, to: string, foreign: string
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import { reviewImageReplacement, applyImageReplacement } from '../src/lib/media-replacement.ts'
async function media(site: string) {
  const id = randomUUID()
  await db.as('owner', async client => {
    await client.query(
      `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'test.jpg','A test image',10,10,99,'image/jpeg','ready')`,
      [id, site, id, 'a'.repeat(64)],
    )
    await client.query(
      `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,99,'image/webp')`,
      [id, id + '/wide', 'b'.repeat(64)],
    )
  })
  return id
}
async function page(title: string) {
  return db.asUser(s.editorA, async client => {
    const id = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        s.siteA,
        'image-' + randomUUID().slice(0, 8),
        title,
      ])
    ).rows[0]!.id
    const body = JSON.parse(heroContent(s.heroDefId, title))
    body[0].values.photo = {
      media_id: from,
      variant: 'wide',
      src: `/media/${from}/wide`,
      alt: 'The description for this placement',
      decorative: false,
    }
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [id, JSON.stringify(body), '{}'])
    return id
  })
}
beforeAll(async () => {
  db = await TestDatabase.create('media_replacement')
  s = await seedScenario(db)
  from = await media(s.siteA)
  to = await media(s.siteA)
  foreign = await media(s.siteB)
})
afterAll(async () => {
  await db?.close()
})
describe('reviewed draft-only image replacement', () => {
  it('lists current uses and preserves live pointers, binaries, descriptions and history', async () => {
    const id = await page('Original picture')
    await db.asUser(s.editorA, client => client.query('SELECT app.publish_page($1,1,$2,$3,$4)', [id, ...CHECKED_CLEAN]))
    const before = await db.asUser(
      s.editorA,
      async client => (await client.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!,
    )
    const review = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    expect(review.targets.find(target => target.key === `page:${id}`)?.name).toBe('Original picture')
    expect(await applyImageReplacement(s.editorA, s.siteA, from, to, review.fingerprint, [`page:${id}`])).toEqual({
      count: 1,
    })
    await db.asUser(s.editorA, async client => {
      const current = (
        await client.query(
          'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!
      expect(current.published_version_id).toBe(before.published_version_id)
      expect(current.content[0].values.photo).toEqual({
        media_id: to,
        variant: 'wide',
        src: `/media/${to}/wide`,
        alt: 'The description for this placement',
        decorative: false,
      })
      expect(
        (await client.query('SELECT content FROM page_versions WHERE id=$1', [before.published_version_id])).rows[0]!
          .content[0].values.photo.media_id,
      ).toBe(from)
      expect(
        (
          await client.query("SELECT count(*)::int AS n FROM media WHERE id=ANY($1::uuid[]) AND status='ready'", [
            [from, to],
          ])
        ).rows[0]!.n,
      ).toBe(2)
    })
  })
  it('refuses stale reviews and replay without making another draft', async () => {
    const id = await page('Stale image review'),
      review = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    await db.asUser(s.editorA, async client => {
      const current = (
        await client.query(
          'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!
      current.content[0].values.heading = 'Newer edit'
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        id,
        current.revision,
        JSON.stringify(current.content),
        '{}',
      ])
    })
    await expect(
      applyImageReplacement(s.editorA, s.siteA, from, to, review.fingerprint, [`page:${id}`]),
    ).rejects.toMatchObject({ kind: 'stale_revision' })
    const fresh = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    await applyImageReplacement(s.editorA, s.siteA, from, to, fresh.fingerprint, [`page:${id}`])
    await expect(
      applyImageReplacement(s.editorA, s.siteA, from, to, fresh.fingerprint, [`page:${id}`]),
    ).rejects.toMatchObject({ kind: 'stale_revision' })
  })
  it('refuses foreign images, foreign users, unavailable assets and invented destinations', async () => {
    await expect(reviewImageReplacement(s.editorB, s.siteA, from, to)).rejects.toMatchObject({ kind: 'not_found' })
    await expect(reviewImageReplacement(s.editorA, s.siteA, from, foreign)).rejects.toMatchObject({
      kind: 'invalid_state',
    })
    const review = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    await expect(
      applyImageReplacement(s.editorA, s.siteA, from, to, review.fingerprint, ['page:' + s.pageA]),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    await db.as('owner', client =>
      client.query("UPDATE media SET status='deleted',deleted_at=clock_timestamp() WHERE id=$1", [to]),
    )
    await expect(reviewImageReplacement(s.editorA, s.siteA, from, to)).rejects.toMatchObject({ kind: 'invalid_state' })
    await db.as('owner', client => client.query("UPDATE media SET status='ready',deleted_at=NULL WHERE id=$1", [to]))
  })
  it('replaces selected list and frame references while preserving unselected entries and live heads', async () => {
    const list = await db.asUser(s.superAdmin, async client => {
      const id = (
        await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          s.siteA,
          'pictures',
          'Pictures',
          'pictures',
          JSON.stringify([
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'photo', label: 'Photo', type: 'image', required: false },
          ]),
          JSON.stringify({
            schemaVersion: 1,
            titleField: 'name',
            subtitleField: null,
            imageField: 'photo',
            groupField: null,
          }),
        ])
      ).rows[0]!.collection_id
      await client.query('SELECT app.save_collection_entries($1,0,$2)', [
        id,
        JSON.stringify([
          {
            id: null,
            stableKey: 'first',
            values: {
              name: 'First',
              photo: { src: `/media/${from}/wide`, alt: 'A specific portrait', decorative: false },
            },
          },
          { id: null, stableKey: 'second', values: { name: 'Second' } },
        ]),
      ])
      const frames = (
          await client.query(
            'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
            [s.siteA],
          )
        ).rows,
        header = frames.find(row => row.kind === 'header')!,
        footer = frames.find(row => row.kind === 'footer')!
      header.content.brand.logoMediaId = from
      await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        s.siteA,
        header.revision,
        footer.revision,
        JSON.stringify(header.content),
        JSON.stringify(footer.content),
      ])
      return id
    })
    const contributor = await reviewImageReplacement(s.contributorA, s.siteA, from, to)
    expect(contributor.targets.find(target => target.key === 'frame')?.available).toBe(false)
    const review = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    expect(
      review.targets
        .filter(target => target.key === 'frame' || target.key === `list:${list}`)
        .map(target => target.available),
    ).toEqual([true, true])
    await applyImageReplacement(s.editorA, s.siteA, from, to, review.fingerprint, [`list:${list}`, 'frame'])
    await db.asUser(s.editorA, async client => {
      const rows = (
        await client.query(
          'SELECT e.stable_key,v."values",e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index',
          [list],
        )
      ).rows
      expect(rows.map(row => row.stable_key)).toEqual(['first', 'second'])
      expect(rows[0]!.values.photo.src).toBe(`/media/${to}/wide`)
      expect(rows[0]!.values.photo.alt).toBe('A specific portrait')
      expect(rows[1]!.values).toEqual({ name: 'Second', photo: '' })
      expect(rows.every(row => row.published_version_id === null)).toBe(true)
      const frame = (
        await client.query(
          "SELECT d.content AS draft,l.content AS live FROM global_elements g JOIN global_element_versions d ON d.id=g.draft_version_id JOIN global_element_versions l ON l.id=g.published_version_id WHERE g.site_id=$1 AND g.kind='header'",
          [s.siteA],
        )
      ).rows[0]!
      expect(frame.draft.brand.logoMediaId).toBe(to)
      expect(frame.live.brand.logoMediaId).toBeNull()
    })
  })
  it('refuses a review when list fields changed, even if its item save counter did not', async () => {
    const id = await page('Field change refusal'),
      review = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    await db.asUser(s.superAdmin, async client => {
      const list = (
        await client.query(
          "SELECT c.id,c.revision,v.fields,v.sort AS presentation FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.reader_key='pictures'",
          [s.siteA],
        )
      ).rows[0]!
      list.fields[0].help = 'Changed since the replacement review'
      await client.query('SELECT app.save_collection_schema($1,$2,$3,$4)', [
        list.id,
        list.revision,
        JSON.stringify(list.fields),
        JSON.stringify(list.presentation),
      ])
    })
    await expect(
      applyImageReplacement(s.editorA, s.siteA, from, to, review.fingerprint, [`page:${id}`]),
    ).rejects.toMatchObject({ kind: 'stale_revision' })
  })
  it('keeps authored code changes restricted to Super Admins and still flags the resulting draft', async () => {
    const id = await page('An authored image')
    await db.asUser(s.superAdmin, async client => {
      const current = (
        await client.query(
          'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!
      current.content[0].raw_html = `<img src="/media/${from}/wide" alt="A custom image">`
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        id,
        current.revision,
        JSON.stringify(current.content),
        '{}',
      ])
    })
    const editor = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    expect(editor.targets.find(target => target.key === `page:${id}`)?.available).toBe(false)
    await expect(
      applyImageReplacement(s.editorA, s.siteA, from, to, editor.fingerprint, [`page:${id}`]),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    const root = await reviewImageReplacement(s.superAdmin, s.siteA, from, to)
    expect(root.targets.find(target => target.key === `page:${id}`)?.available).toBe(true)
    await applyImageReplacement(s.superAdmin, s.siteA, from, to, root.fingerprint, [`page:${id}`])
    await db.asUser(s.superAdmin, async client => {
      const row = (
        await client.query(
          'SELECT v.content,v.carries_trusted_code FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!
      expect(row.carries_trusted_code).toBe(true)
      expect(row.content[0].raw_html).toContain(`/media/${to}/wide`)
      expect(row.content[0].raw_html).not.toContain(from)
    })
  })
  it('rolls every draft back when a later command fails', async () => {
    const [first, second] = [await page('Atomic first'), await page('Atomic second')].sort() as [string, string],
      review = await reviewImageReplacement(s.editorA, s.siteA, from, to)
    await db.as('owner', async client => {
      await client.query(
        `CREATE FUNCTION public.test_refuse_image_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.page_id='${second}'::uuid THEN RAISE EXCEPTION 'simulated save failure'; END IF; RETURN NEW; END $$`,
      )
      await client.query(
        'CREATE TRIGGER test_refuse_image_save BEFORE INSERT ON page_versions FOR EACH ROW EXECUTE FUNCTION public.test_refuse_image_save()',
      )
    })
    await expect(
      applyImageReplacement(s.editorA, s.siteA, from, to, review.fingerprint, [`page:${first}`, `page:${second}`]),
    ).rejects.toThrow('simulated save failure')
    await db.as('owner', async client => {
      await client.query('DROP TRIGGER test_refuse_image_save ON page_versions')
      await client.query('DROP FUNCTION public.test_refuse_image_save()')
    })
    await db.asUser(s.editorA, async client => {
      for (const id of [first, second]) {
        const row = (
          await client.query(
            'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
            [id],
          )
        ).rows[0]!
        expect(Number(row.revision)).toBe(1)
        expect(row.content[0].values.photo.media_id).toBe(from)
      }
    })
  })
})
