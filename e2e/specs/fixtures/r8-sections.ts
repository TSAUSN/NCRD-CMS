import { randomUUID } from 'node:crypto'
import { compileSection } from '@cms/renderer'
import { siteLookFixture } from './r8-site-look.ts'
export async function sectionsFixture() {
  const fixture = await siteLookFixture(),
    client = await fixture.pool.connect(),
    slug = 'reviewed-' + randomUUID().slice(0, 8),
    name = 'Community welcome — a clear introduction with a deliberately long section name'
  let released = false
  try {
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const slots = [
      {
        id: 'heading',
        kind: 'text' as const,
        label: 'A welcoming headline',
        constraints: { sourceSample: 'Welcome, everyone' },
      },
      {
        id: 'intro',
        kind: 'text' as const,
        label: 'A helpful introduction',
        constraints: { sourceSample: 'A place to meet and connect.' },
      },
    ]
    async function save(version: number, definitionId: string | null) {
      const sourceHtml =
          '<section class="welcome"><h1>{{heading}}</h1><p>{{intro}}</p>' +
          (version > 1 ? '<p>More welcoming spaces</p><p>{{newwords}}</p>' : '') +
          '</section>',
        sourceCss = '.welcome{padding:2rem;background:var(--color-surface);color:var(--color-ink)}',
        fields =
          version > 1
            ? [...slots, { id: 'newwords', kind: 'text' as const, label: 'A new optional welcome', constraints: {} }]
            : slots,
        compiled = compileSection({ sourceHtml, sourceCss, slots: fields, scopeSelector: '.cms-section--' + slug })
      if (compiled.blocking.length) throw new Error(compiled.blocking.join(' '))
      return (
        await client.query(
          'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
          [
            slug,
            name,
            'Text & stories',
            sourceHtml,
            sourceCss,
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(fields),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            version === 1 ? 'First welcome' : 'A clearer welcome with space for one more line',
            false,
            'legacy',
            null,
            null,
            'site',
            fixture.site,
            version - 1,
            definitionId,
          ],
        )
      ).rows[0]!
    }
    const definition = (await save(1, null)).section_def_id
    for (const pageId of fixture.pages) {
      const page = (await client.query('SELECT revision FROM pages WHERE id=$1', [pageId])).rows[0]!
      const content = [
        {
          section_def_id: definition,
          section_def_version: 1,
          label: 'Welcome',
          hidden: false,
          hidden_at: [],
          values: {
            heading: pageId === fixture.pages[0] ? 'Welcome' : 'Visit us',
            intro: 'Keep these original words.',
          },
        },
      ]
      const saved = (
        await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          pageId,
          page.revision,
          JSON.stringify(content),
          JSON.stringify({ description: 'A complete page for reviewing section updates.' }),
        ])
      ).rows[0]!
      await client.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [pageId, saved.revision])
    }
    await save(2, definition)
    await client.query('COMMIT')
    return { ...fixture, definition, slug, name }
  } catch (error) {
    await client.query('ROLLBACK')
    client.release()
    released = true
    await fixture.pool.end()
    throw error
  } finally {
    if (!released) client.release()
  }
}
