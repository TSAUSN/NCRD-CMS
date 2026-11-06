import { createHmac, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { demoSpeakersCollection } from '@cms/seeds'
import { e2eTarget } from '../test-target.ts'

function cookie(email: string) {
  const payload = Buffer.from(JSON.stringify({ subject: `local|${email}`, email })).toString('base64url')
  return `cms_session=${payload}.${createHmac('sha256', 'e2e-secret-value-not-used-in-production').update(payload).digest('base64url')}`
}

test('HTTP collection choices expose only compatible published records in the authorized site', async ({ request }) => {
  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  let siteId = '',
    rootId = ''
  try {
    rootId = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    siteId = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `http-collections-${randomUUID().slice(0, 8)}`,
        'HTTP collection fixture',
        'event',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    const created = (
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        siteId,
        'speakers',
        'Speakers',
        'speakers',
        JSON.stringify(demoSpeakersCollection.fields),
        JSON.stringify(demoSpeakersCollection.presentation),
      ])
    ).rows[0]!
    const collection = created.collection_id
    await client.query('SELECT app.publish_collection_schema($1,$2)', [collection, created.revision])
    const listing = (
      await client.query(
        "SELECT d.id AS section_def_id,max(v.version) AS section_def_version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='speakers-listing' AND d.scope='global' GROUP BY d.id",
      )
    ).rows[0]!
    const saved = (
      await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        collection,
        0,
        JSON.stringify([
          {
            id: null,
            stableKey: 'http-speaker',
            values: { name: 'Published HTTP speaker', role: 'Speaker', bio: '<p>Isolated fixture.</p>', photo: '' },
          },
        ]),
      ])
    ).rows[0]!
    await client.query('COMMIT')
    const url = `/api/sites/${siteId}/collection-options?definition=${listing.section_def_id}&version=${listing.section_def_version}&field=speakers`
    const headers = { cookie: cookie('root@example.test') }
    const draft = await request.get(url, { headers })
    expect(draft.status()).toBe(200)
    expect(draft.headers()['cache-control']).toBe('private, no-store')
    expect(await draft.json()).toMatchObject({
      options: [{ id: collection, readerKey: 'speakers', compatible: true, entries: [] }],
    })
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
    await client.query('SELECT app.publish_collection_entries($1,$2)', [collection, saved.entry_revision])
    await client.query('COMMIT')
    const published = await request.get(url, { headers })
    expect(published.status()).toBe(200)
    expect(await published.json()).toMatchObject({
      options: [{ id: collection, entries: [{ stableKey: 'http-speaker', title: 'Published HTTP speaker' }] }],
    })
    expect((await request.get(url)).status()).toBe(404)
    expect((await request.get(url, { headers: { cookie: cookie('editor@example.test') } })).status()).toBe(404)
    for (const invalid of [
      url.replace('field=speakers', 'field=heading'),
      url.replace(`version=${listing.section_def_version}`, 'version=999'),
      url.replace(`definition=${listing.section_def_id}`, 'definition=not-a-uuid'),
    ]) {
      expect((await request.get(invalid, { headers })).status()).toBe(404)
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (siteId) {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.user_id',$1,true)", [rootId])
      const row = (await client.query('SELECT revision FROM sites WHERE id=$1', [siteId])).rows[0]!
      await client.query('SELECT app.archive_site($1,$2)', [siteId, row.revision])
      await client.query('COMMIT')
    }
    await client.end()
  }
})
