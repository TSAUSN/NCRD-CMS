import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
export async function siteLookFixture() {
  const pool = new Pool({
      connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
    }),
    client = await pool.connect(),
    suffix = randomUUID().slice(0, 8),
    picture = randomUUID(),
    compactPicture = randomUUID(),
    host = `look-${suffix}.staging.localhost`
  let released = false
  try {
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const theme = (
      await client.query(
        "SELECT v.tokens FROM themes t JOIN theme_versions v ON v.id=t.published_version_id JOIN sites s ON s.id=t.site_id WHERE s.slug='demo'",
      )
    ).rows[0]!.tokens
    const site = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `look-${suffix}`,
        'Shared site look',
        'resource',
        host,
        JSON.stringify(theme),
        '[]',
      ])
    ).rows[0]!.id
    for (const [email, role] of [
      ['editor@example.test', 'editor'],
      ['contributor@example.test', 'contributor'],
    ]) {
      const person = (await client.query('SELECT id FROM app_users WHERE email=$1', [email])).rows[0]!.id
      await client.query('SELECT app.set_site_membership($1,$2,$3)', [person, site, role])
    }
    const hero = (
      await client.query(
        "SELECT d.id,max(v.version)::int AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    const pages: string[] = []
    for (const [slug, title] of [
      ['', 'Welcome'],
      ['visit', 'Visit us'],
    ]) {
      const id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, title])).rows[0]!.id
      await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify([
          {
            section_def_id: hero.id,
            section_def_version: hero.version,
            label: 'Welcome',
            hidden: false,
            hidden_at: [],
            values: { heading: title, intro: 'A locally reviewed site with a clear next step.' },
          },
        ]),
        JSON.stringify({ description: 'A complete page for reviewing shared appearance.' }),
      ])
      pages.push(id)
    }
    await client.query('SELECT app.publish_theme($1,1)', [site])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [site])
    for (const id of pages) await client.query("SELECT app.publish_page($1,1,3,NULL,'[]')", [id])
    const nav = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [site])).rows[0]!
    await client.query('SELECT app.publish_navigation($1,$2)', [site, nav.revision])
    for (const [id, name, originalHash, variantHash] of [
      [picture, 'Local demonstration logo.png', 'a', 'b'],
      [compactPicture, 'Local compact logo.png', 'c', 'd'],
    ]) {
      await client.query(
        `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,uploaded_by) VALUES($1,$2,$3,$4,$5,'Local demonstration mark',800,800,20000,'image/png','ready',$6)`,
        [id, site, 'r8-look/' + id, originalHash!.repeat(64), name, actor],
      )
      for (const kind of ['wide', 'thumbnail'])
        await client.query(
          `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,800,800,20000,'image/webp')`,
          [id, kind, `r8-look/${id}/${kind}`, variantHash!.repeat(64)],
        )
    }
    await client.query('COMMIT')
    return { pool, site, pages, host, picture, compactPicture }
  } catch (error) {
    await client.query('ROLLBACK')
    client.release()
    released = true
    await pool.end()
    throw error
  } finally {
    if (!released) client.release()
  }
}
