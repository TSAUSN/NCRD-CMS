import { isDeepStrictEqual } from 'node:util'
import type { Queryable } from '@cms/platform'
import { compileSeedSection, upsertArguments } from '@cms/seeds'
import { NATIONAL_HEADER, NATIONAL_FOOTER } from '@cms/seeds/national-library'
import { SAWSO_HOME_APPROVED } from '@cms/seeds/sawso-home-approved'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { STORY_SECTORS } from '@cms/seeds/sawso-stories'
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Installs ordinary authored global components. It never changes another site's frame. */
export async function installNationalFrames(client: Queryable) {
  const components = []
  for (const [kind, definition] of [
    ['header', NATIONAL_HEADER],
    ['footer', NATIONAL_FOOTER],
  ] as const) {
    const compiled = compileSeedSection(definition)
    if (compiled.problems.length) throw new Error(compiled.problems.join('; '))
    let current = (
      await client.query(
        "SELECT d.id,v.version,v.render_hash,v.slots FROM section_defs d JOIN LATERAL(SELECT version,render_hash,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug=$1",
        [definition.slug],
      )
    ).rows[0]
    if (!current || current.render_hash !== compiled.renderHash || !isDeepStrictEqual(current.slots, compiled.slots)) {
      const saved = (
        await client.query(
          'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [...upsertArguments(definition), 'global', null],
        )
      ).rows[0]!
      current = { id: saved.section_def_id, version: saved.version }
    }
    await client.query('SELECT app.set_section_def_placement($1,$2)', [current.id, kind])
    components.push({ section_def_id: current.id, section_def_version: current.version })
  }
  return components
}
export async function ensureSawsoFrame(client: Queryable, siteId: string) {
  const components = await installNationalFrames(client)
  const source = SAWSO_HOME_APPROVED.sections.Footer
  const blocks = source.split('\n\n')
  const mission = /^\*\*([^*]+)\*\* (.+)$/.exec(blocks[0]!)!
  const targets = [
    '/',
    'https://give.sawso.org',
    '/our-team',
    '/#contact',
    'https://www.salvationarmyusa.org',
    'https://www.salvationarmy.org',
  ]
  const labels = blocks[1]!.replace('Links: ', '').split(' · ')
  const brand = {
    logo: { src: '/cms-themes/sawso/salvation-army-shield.svg', alt: 'The Salvation Army', decorative: false },
    name: 'World Service Office',
    tagline: 'Hope in Every Language',
  }
  const header = {
    schemaVersion: 2,
    enabled: true,
    sticky: true,
    component: { ...components[0], values: { ...brand, donate: { label: 'Donate', url: 'https://give.sawso.org' } } },
  }
  const { logo: _logo, ...footerBrand } = brand
  const footer = {
    schemaVersion: 2,
    enabled: true,
    component: {
      ...components[1],
      values: {
        ...footerBrand,
        mission_heading: mission[1],
        mission: '<p>' + escape(mission[2]!) + '</p>',
        links: labels.map((label, i) => '<p><a href="' + targets[i] + '">' + escape(label) + '</a></p>').join(''),
        address: '<p>The Salvation Army World Service Office<br>615 Slaters Lane, Alexandria, VA 22314</p>',
        disclaimer: '<p>' + escape(blocks[2]!) + '</p>',
        base: '<p>' + escape(blocks[3]!).replace('Privacy Policy', '<a href="/privacy">Privacy Policy</a>') + '</p>',
      },
    },
  }
  const heads = (
    await client.query(
      'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
      [siteId],
    )
  ).rows
  const h = heads.find(r => r.kind === 'header')!
  const f = heads.find(r => r.kind === 'footer')!
  const nextHeader =
    h.content.schemaVersion === 1
      ? header
      : h.content.component?.section_def_id === components[0]!.section_def_id
        ? {
            ...h.content,
            component: {
              ...h.content.component,
              ...components[0],
              values: { logo: brand.logo, ...h.content.component.values },
            },
          }
        : h.content
  const nextFooter =
    f.content.schemaVersion === 1
      ? footer
      : f.content.component?.section_def_id === components[1]!.section_def_id
        ? {
            ...f.content,
            component: { ...f.content.component, ...components[1], values: { ...f.content.component.values } },
          }
        : f.content
  if (!isDeepStrictEqual(nextHeader, h.content) || !isDeepStrictEqual(nextFooter, f.content))
    await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      siteId,
      h.revision,
      f.revision,
      JSON.stringify(nextHeader),
      JSON.stringify(nextFooter),
    ])
  const theme = (
    await client.query(
      'SELECT t.revision,v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
      [siteId],
    )
  ).rows[0]!
  if (!isDeepStrictEqual(theme.tokens, SAWSO_THEME))
    await client.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [
      siteId,
      theme.revision,
      JSON.stringify(SAWSO_THEME),
    ])
  const nav = (
    await client.query(
      'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
      [siteId],
    )
  ).rows[0]!
  const pages = (await client.query('SELECT id,slug FROM pages WHERE site_id=$1 AND archived_at IS NULL', [siteId]))
    .rows
  const item = (label: string, slug: string) => ({
    label,
    target: { type: 'page', page_id: pages.find(p => p.slug === slug)!.id },
    visible: true,
  })
  const tree = [
    {
      ...item('Ways We Help', 'ways-we-help'),
      children: [
        'anti-human-trafficking',
        'business-economic-development',
        'capacity-building',
        'disaster-relief-recovery',
        'education',
        'family-care',
        'health',
        'livelihoods',
      ]
        .map(id => STORY_SECTORS.find(s => s.id === id)!)
        .map(s => item(s.label, 'ways-we-help/' + s.id)),
    },
    {
      label: 'Ways to Give',
      target: { type: 'url', url: 'https://give.sawso.org' },
      visible: true,
      children: [
        { label: 'Donate Today', target: { type: 'url', url: 'https://give.sawso.org' }, visible: true },
        item('Annual Reports', 'annual-reports'),
        item('Financial Accountability', 'financial-accountability'),
      ],
    },
    item('Newsroom', 'newsroom'),
  ]
  if (
    nav.tree.length <= 3 &&
    (!nav.tree.some((i: { children?: unknown[] }) => i.children?.length) ||
      (nav.tree[0]?.label === 'Ways We Help' &&
        nav.tree[0]?.children?.length === 8 &&
        nav.tree[1]?.label === 'Ways to Give' &&
        !nav.tree[1]?.children?.length &&
        nav.tree[2]?.label === 'Newsroom'))
  )
    await client.query("SELECT * FROM app.save_navigation_draft($1,$2,$3,'manual')", [
      siteId,
      nav.revision,
      JSON.stringify(tree),
    ])
}
