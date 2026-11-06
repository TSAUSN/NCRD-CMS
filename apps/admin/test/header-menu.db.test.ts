import { saveFooterDraft } from '../src/lib/footer-draft.ts'
import { afterAll, beforeAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { HeaderConfig, FooterConfig } from '@cms/schema'
import { saveHeaderMenuDraft, type HeaderMenuDraft } from '../src/lib/header-menu.ts'
import { installNationalFrames } from '../src/lib/sawso-frame.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('header_menu')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function state() {
  return db.asUser(s.superAdmin, async client => {
    const frames = (
      await client.query(
        'SELECT g.kind,g.revision,g.draft_version_id,g.published_version_id,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [s.siteA],
      )
    ).rows
    const header = frames.find(item => item.kind === 'header')!,
      footer = frames.find(item => item.kind === 'footer')!,
      menu = (
        await client.query(
          'SELECT n.revision,n.mode,n.published_version_id,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
          [s.siteA],
        )
      ).rows[0]!
    return {
      header,
      footer,
      menu,
      input: {
        siteId: s.siteA,
        headerRevision: Number(header.revision),
        footerRevision: Number(footer.revision),
        menuRevision: Number(menu.revision),
        header: HeaderConfig.parse(header.content),
        menu: menu.tree,
        mode: menu.mode,
      } as HeaderMenuDraft,
    }
  })
}
it('saves a Site admin menu draft without changing header/footer heads or publishing', async () => {
  const before = await state()
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'site_admin']),
  )
  await db.asUser(s.editorA, client =>
    saveHeaderMenuDraft(client, {
      ...before.input,
      menu: [{ label: 'Visit', target: { type: 'url', url: '/visit' }, visible: true }],
      mode: 'manual',
    }),
  )
  const after = await state()
  expect(after.header).toEqual(before.header)
  expect(after.footer).toEqual(before.footer)
  expect(after.menu.tree).toEqual([{ label: 'Visit', target: { type: 'url', url: '/visit' }, visible: true }])
  expect(after.menu.published_version_id).toBe(before.menu.published_version_id)
})
it('rolls back a header edit when another menu save won and refuses ordinary Editors', async () => {
  const before = await state(),
    header = HeaderConfig.parse(before.input.header)
  if (header.schemaVersion !== 1) throw Error('Expected preset fixture')
  header.brand.siteName = '[Changed name]'
  await expect(
    db.asUser(s.editorA, client =>
      saveHeaderMenuDraft(client, { ...before.input, header, menuRevision: before.input.menuRevision - 1 }),
    ),
  ).rejects.toThrow('Someone else saved the menu')
  expect((await state()).header).toEqual(before.header)
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'editor']),
  )
  await expect(db.asUser(s.editorA, client => saveHeaderMenuDraft(client, before.input))).rejects.toThrow(
    'A Site admin',
  )
  expect((await state()).footer).toEqual(before.footer)
})
it('prepares immutable shared frame definitions without changing any site pin', async () => {
  const before = await state()
  await db.asUser(s.superAdmin, client => installNationalFrames(client))
  const after = await state()
  expect(after).toEqual(before)
  const versions = await db.asUser(s.superAdmin, client =>
    client.query(
      "SELECT d.slug,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug IN('national-header','national-footer')",
    ),
  )
  expect(versions.rows).toHaveLength(2)
  expect(
    versions.rows.find(row => row.slug === 'national-footer')?.slots.find((slot: { id: string }) => slot.id === 'logo')
      ?.constraints.inheritHeaderLogo,
  ).toBe(true)
  expect(versions.rows.every(row => row.slots.some((slot: { id: string }) => slot.id === 'logo'))).toBe(true)
})

it('a header-only draft advances only its own version and preserves footer, menu and live heads', async () => {
  const before = await state(),
    header = HeaderConfig.parse(before.input.header)
  if (header.schemaVersion !== 1) throw Error('Expected preset fixture')
  header.brand.siteName = '[Reviewed header name]'
  await db.asUser(s.superAdmin, client => saveHeaderMenuDraft(client, { ...before.input, header }))
  const after = await state()
  expect(Number(after.header.revision)).toBe(Number(before.header.revision) + 1)
  expect(after.header.published_version_id).toBe(before.header.published_version_id)
  expect(after.footer).toEqual(before.footer)
  expect(after.menu).toEqual(before.menu)
})

it('saves only the footer and rejects stale or non-admin edits without changing other heads', async () => {
  const before = await state(),
    footer = FooterConfig.parse(before.footer.content)
  if (footer.schemaVersion !== 1) throw Error('fixture')
  footer.brand.blurb = '[Reviewed footer text]'
  await db.asUser(s.superAdmin, client => saveFooterDraft(client, { ...before.input, footer }))
  const after = await state()
  expect(after.header).toEqual(before.header)
  expect(after.menu).toEqual(before.menu)
  expect(after.footer.published_version_id).toBe(before.footer.published_version_id)
  expect(after.footer.content.brand.blurb).toBe('[Reviewed footer text]')
  await expect(db.asUser(s.superAdmin, client => saveFooterDraft(client, { ...before.input, footer }))).rejects.toThrow(
    'Someone else saved',
  )
  await expect(db.asUser(s.editorA, client => saveFooterDraft(client, { ...after.input, footer }))).rejects.toThrow(
    'A Site admin',
  )
  expect((await state()).footer).toEqual(after.footer)
})

it('saves authored email and phone buttons without changing footer, menu or live heads', async () => {
  const initial = await state(),
    def = await db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query(
            "SELECT d.id,max(v.version)::int AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='national-header' AND d.scope='global' GROUP BY d.id",
          )
        ).rows[0]!,
    )
  for (const url of ['mailto:hello@example.test', 'tel:+1-202-555-0100']) {
    const before = await state(),
      header = HeaderConfig.parse({
        schemaVersion: 2,
        enabled: true,
        sticky: true,
        component: {
          section_def_id: def.id,
          section_def_version: def.version,
          values: {
            logo: { src: '/cms-themes/sawso/salvation-army-shield.svg', alt: 'The Salvation Army', decorative: false },
            name: '[Site name]',
            tagline: '',
            donate: { label: 'Donate', url, trackingCode: 'utm_source=site' },
          },
        },
      })
    await db.asUser(s.superAdmin, client => saveHeaderMenuDraft(client, { ...before.input, header }))
    const after = await state()
    expect(after.header.content.component.values.donate.url).toBe(url)
    expect(after.header.published_version_id).toBe(initial.header.published_version_id)
    expect(after.footer).toEqual(initial.footer)
    expect(after.menu).toEqual(initial.menu)
  }
})
it('rejects an authored executable button destination before changing saved heads', async () => {
  const before = await state(),
    header = structuredClone(before.input.header)
  if (header.schemaVersion !== 2) throw Error('Expected authored fixture')
  header.component.values.donate = { label: 'Donate', url: 'javascript:alert(1)' }
  await expect(
    db.asUser(s.superAdmin, client => saveHeaderMenuDraft(client, { ...before.input, header })),
  ).rejects.toThrow('valid page, website, email or phone')
  expect(await state()).toEqual(before)
})
