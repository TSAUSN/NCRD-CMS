import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { expectSqlState, TestDatabase } from './harness.ts'

let db: TestDatabase
let s: Scenario

async function ready(siteId: string | null, name: string, tags: string[] = []): Promise<string> {
  return db.as(
    'owner',
    async client =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO media(
       site_id,object_key,content_hash,original_name,alt_text,decorative,
       width,height,bytes,mime_type,status,uploaded_by,folder,attribution,source,tags
     ) VALUES($1,$2,$3,$4,$5,false,1200,800,120000,'image/jpeg','ready',$6,'','','',$7)
     RETURNING id`,
          [
            siteId,
            `organization/${randomUUID()}.jpg`,
            randomUUID().replaceAll('-', '').padEnd(64, 'a'),
            name,
            `${name} description`,
            s.superAdmin,
            tags,
          ],
        )
      ).rows[0]!.id,
  )
}

beforeAll(async () => {
  db = await TestDatabase.create('media_organization')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

describe('atomic media organization', () => {
  it('moves and tags a bounded selection with one revision increment per asset', async () => {
    const first = await ready(s.siteA, 'first.jpg', ['existing'])
    const second = await ready(s.siteA, 'second.jpg')
    const changed = await db.asUser(s.editorA, client =>
      client.query(
        `SELECT * FROM app.bulk_organize_media(
        $1::uuid[],$2::bigint[],$3,$4::text[],$5::text[])`,
        [[first, second], [1, 1], 'Campaigns/Fall Appeal', ['approved', 'hero'], ['existing']],
      ),
    )
    expect(changed.rows).toEqual([
      { media_id: first, revision: '2' },
      { media_id: second, revision: '2' },
    ])
    const rows = await db.asUser(s.editorA, client =>
      client.query('SELECT id,revision,folder,tags FROM media WHERE id=ANY($1::uuid[]) ORDER BY original_name', [
        [first, second],
      ]),
    )
    expect(rows.rows).toEqual([
      { id: first, revision: '2', folder: 'Campaigns/Fall Appeal', tags: ['approved', 'hero'] },
      { id: second, revision: '2', folder: 'Campaigns/Fall Appeal', tags: ['approved', 'hero'] },
    ])
  })

  it('rolls the whole organization command back on one stale revision', async () => {
    const first = await ready(s.siteA, 'atomic-first.jpg')
    const second = await ready(s.siteA, 'atomic-second.jpg')
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.bulk_organize_media($1,$2,$3,$4,$5)', [
          [first, second],
          [1, 9],
          'Should Not Persist',
          [],
          [],
        ]),
      ),
      'CMS01',
    )
    expect(
      (
        await db.as('owner', client =>
          client.query('SELECT revision,folder FROM media WHERE id=ANY($1::uuid[]) ORDER BY id', [[first, second]]),
        )
      ).rows,
    ).toEqual([
      { revision: '1', folder: '' },
      { revision: '1', folder: '' },
    ])
  })

  it('keeps shared organization super-admin-only', async () => {
    const shared = await ready(null, 'shared.jpg')
    await expectSqlState(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.bulk_organize_media($1,$2,$3,$4,$5)', [[shared], [1], 'Foundation', [], []]),
      ),
      'CMS02',
    )
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query('SELECT revision FROM app.bulk_organize_media($1,$2,$3,$4,$5)', [
            [shared],
            [1],
            'Foundation',
            ['approved'],
            [],
          ]),
        )
      ).rows,
    ).toEqual([{ revision: '2' }])
  })

  it('makes bulk deletion atomic when one selected asset is referenced', async () => {
    const first = await ready(s.siteA, 'delete-first.jpg')
    const second = await ready(s.siteA, 'delete-second.jpg')
    await db.as('owner', client =>
      client.query(
        `INSERT INTO media_usage(media_id,site_id,item_type,item_id,version_id)
       VALUES($1,$2,'page',$3,$4)`,
        [second, s.siteA, s.pageA, randomUUID()],
      ),
    )
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT * FROM app.bulk_soft_delete_media($1,$2,false,NULL)', [
          [first, second],
          [1, 1],
        ]),
      ),
      'CMS04',
    )
    expect(
      (
        await db.as('owner', client =>
          client.query('SELECT status,revision FROM media WHERE id=ANY($1::uuid[]) ORDER BY id', [[first, second]]),
        )
      ).rows,
    ).toEqual([
      { status: 'ready', revision: '1' },
      { status: 'ready', revision: '1' },
    ])
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query('SELECT count(*)::int AS count FROM app.bulk_soft_delete_media($1,$2,true,$3)', [
            [first, second],
            [1, 1],
            'Approved campaign cleanup',
          ]),
        )
      ).rows,
    ).toEqual([{ count: 2 }])
  })
})
