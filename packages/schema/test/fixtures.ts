// Two sites and four people, built through the real commands rather than by
// INSERTing rows behind the commands' backs — so the fixtures themselves are a
// first test that the command surface is usable.
import type { PoolClient } from 'pg'
import type { TestDatabase } from './harness.ts'

export const SUPER_ADMIN = '00000000-0000-0000-0000-0000000000a1'

export type Scenario = {
  superAdmin: string
  editorA: string
  contributorA: string
  editorB: string
  disabled: string
  siteA: string
  siteB: string
  pageA: string
  heroDefId: string
}

const THEME = {
  colors: { primary: '#003087', surface: '#ffffff', ink: '#1a1a1a' },
  fonts: { heading: "Georgia, 'Times New Roman', serif", body: 'system-ui, sans-serif' },
  radius: '0.5rem',
}

async function seedPrincipal(client: PoolClient, id: string, email: string): Promise<void> {
  await client.query('INSERT INTO app_users (id, email, display_name) VALUES ($1, $2, $3)', [id, email, email])
}

export async function seedScenario(db: TestDatabase): Promise<Scenario> {
  // Bootstrapping the very first super admin is a migration-owner act, not a
  // product flow: there is nobody to authorize it yet. Everything afterwards
  // goes through the commands.
  await db.as('owner', async client => {
    await seedPrincipal(client, SUPER_ADMIN, 'root@example.test')
    await client.query("INSERT INTO global_roles (user_id, role) VALUES ($1, 'super_admin')", [SUPER_ADMIN])
  })

  const scenario = await db.asUser(SUPER_ADMIN, async client => {
    const editorA = (
      await client.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [
        'editor-a@example.test',
        'Editor A',
      ])
    ).rows[0]!.id
    const contributorA = (
      await client.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [
        'contrib-a@example.test',
        'Contributor A',
      ])
    ).rows[0]!.id
    const editorB = (
      await client.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [
        'editor-b@example.test',
        'Editor B',
      ])
    ).rows[0]!.id
    const disabled = (
      await client.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', ['gone@example.test', 'Departed'])
    ).rows[0]!.id

    const siteA = (
      await client.query<{ id: string }>('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'site-a',
        'Site A',
        'resource',
        'site-a.staging.example.test',
        JSON.stringify(THEME),
        '[]',
      ])
    ).rows[0]!.id
    const siteB = (
      await client.query<{ id: string }>('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'site-b',
        'Site B',
        'event',
        'site-b.staging.example.test',
        JSON.stringify(THEME),
        '[]',
      ])
    ).rows[0]!.id

    await client.query('SELECT app.set_site_membership($1,$2,$3)', [editorA, siteA, 'editor'])
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [contributorA, siteA, 'contributor'])
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [editorB, siteB, 'editor'])
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [disabled, siteA, 'editor'])
    await client.query("SELECT app.set_user_status($1,'disabled')", [disabled])

    const hero = (
      await client.query<{ section_def_id: string }>(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          'hero',
          'Hero',
          'Openers',
          '<section class="hero"><h1>{{heading}}</h1><p>{{intro}}</p></section>',
          // Authored, then compiled. The compiled form is what a public manifest
          // carries, and the database refuses one that is not scoped (0013).
          '.hero{padding:4rem 1.5rem;text-align:center}',
          '.cms-section--hero .hero{padding:4rem 1.5rem;text-align:center}',
          // The real compiled shape, not a placeholder. These fixtures are now
          // rendered — the scheduler evaluates readiness against a rendered page
          // (SPEC §6.8) — and an AST the renderer cannot walk would make every
          // scheduled publish fail for a reason that exists only in the fixture.
          JSON.stringify({
            nodes: [
              { kind: 'html', value: '<section class="hero"><h1>' },
              { kind: 'slot', slotId: 'heading', slotKind: 'text', context: 'element-text' },
              { kind: 'html', value: '</h1><p>' },
              { kind: 'slot', slotId: 'intro', slotKind: 'text', context: 'element-text' },
              { kind: 'html', value: '</p></section>' },
            ],
            // Sanitizer policy 2: every slot names the sink it lands in, and the
            // database refuses a definition that does not (migration 0012).
            policyVersion: 4,
            cssPolicyVersion: 6,
          }),
          JSON.stringify([
            { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
            { id: 'intro', kind: 'text', label: 'Intro', constraints: {} },
          ]),
          // Literals, not @cms/renderer's constants: the renderer depends on this
          // package, so importing back would be a cycle. Migrations 0012 and 0013
          // are what keep the two honest — a stale number fails loudly here rather
          // than quietly storing something the renderer will refuse.
          'hash-hero-1',
          4,
          6,
          'initial',
        ],
      )
    ).rows[0]!.section_def_id

    const pageA = (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [siteA, '', 'Home']))
      .rows[0]!.id

    return { superAdmin: SUPER_ADMIN, editorA, contributorA, editorB, disabled, siteA, siteB, pageA, heroDefId: hero }
  })
  // This shared fixture represents two existing sites with their original
  // revision-one live shells. Future private creation and first publication
  // are exercised separately; do not make command defaults public for tests.
  await db.as('owner', async client => {
    for (const table of ['themes', 'navigations', 'global_elements']) {
      await client.query(`UPDATE ${table} SET published_version_id=draft_version_id WHERE site_id=ANY($1::uuid[])`, [
        [scenario.siteA, scenario.siteB],
      ])
    }
    await client.query('UPDATE sites SET initial_release_required=false WHERE id=ANY($1::uuid[])', [
      [scenario.siteA, scenario.siteB],
    ])
    await client.query('SELECT app.rebuild_site_shell($1),app.rebuild_site_shell($2)', [scenario.siteA, scenario.siteB])
  })
  return scenario
}

export function heroContent(defId: string, heading = 'A page served by cms-v2'): string {
  return JSON.stringify([
    {
      section_def_id: defId,
      section_def_version: 1,
      values: { heading, intro: 'This HTML left the server complete.' },
      hidden: false,
      hidden_at: [],
      label: 'Hero',
    },
  ])
}
