import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { installNationalFrames } from '../../../apps/admin/src/lib/sawso-frame.ts'
import { signIn } from '../helpers.ts'
import { rawRequest } from '../http.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/round3/header-destinations', engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}
test('Header buttons use four destinations and publish the same reviewed link on every page', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    client = await f.pool.connect()
  try {
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await installNationalFrames(client)
    const def = (
        await client.query(
          "SELECT d.id,max(v.version)::int AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='national-header' AND d.scope='global' GROUP BY d.id",
        )
      ).rows[0]!,
      rows = (
        await client.query(
          'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
          [f.site],
        )
      ).rows,
      head = rows.find(row => row.kind === 'header')!,
      foot = rows.find(row => row.kind === 'footer')!
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5,true)', [
      f.site,
      head.revision,
      foot.revision,
      JSON.stringify({
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
            donate: { label: 'Donate', url: 'https://example.test/give' },
          },
        },
      }),
      JSON.stringify(foot.content),
    ])
    await client.query('COMMIT')
    const baseline = {
      footer: (
        await f.pool.query(
          "SELECT g.kind,g.use_on_live,d.content AS draft,l.content AS live FROM global_elements g JOIN global_element_versions d ON d.id=g.draft_version_id LEFT JOIN global_element_versions l ON l.id=g.published_version_id WHERE g.site_id=$1 AND g.kind='footer'",
          [f.site],
        )
      ).rows,
      menu: (
        await f.pool.query(
          'SELECT n.mode,d.tree AS draft,l.tree AS live FROM navigations n JOIN navigation_versions d ON d.id=n.draft_version_id LEFT JOIN navigation_versions l ON l.id=n.published_version_id WHERE n.site_id=$1',
          [f.site],
        )
      ).rows,
      content: (
        await f.pool.query(
          'SELECT p.id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 ORDER BY p.id',
          [f.site],
        )
      ).rows,
    }
    await signIn(page, 'root@example.test')
    for (const [kind, input, destination] of [
      ['Email', 'hello@example.test', 'mailto:hello@example.test'],
      ['Phone', '+1 202 555 0100', 'tel:+12025550100'],
      [
        'A website',
        'https://example.test/give?form=main#donate',
        'https://example.test/give?form=main&utm_source=site#donate',
      ],
      ['A page', 'visit', '/visit?utm_source=site'],
    ] as const) {
      await page.goto('/sites/' + f.site + '/header')
      await page.getByRole('tab', { name: 'Header buttons', exact: true }).click()
      const donate = page.getByRole('region', { name: 'Donate button', exact: true })
      for (const name of ['A page', 'A website', 'Email', 'Phone'])
        await expect(donate.getByRole('button', { name, exact: true })).toBeVisible()
      await donate.getByRole('button', { name: kind, exact: true }).click()
      if (kind === 'A page') await donate.getByLabel('Page', { exact: true }).selectOption(f.pages[1]!)
      else
        await donate
          .getByLabel(kind === 'Email' ? 'Email address' : kind === 'Phone' ? 'Phone number' : 'Web address', {
            exact: true,
          })
          .fill(input)
      await donate.getByLabel('Tracking code', { exact: true }).fill('utm_source=site')
      await capture(page, kind.toLowerCase().replaceAll(' ', '-'), info.project.name)
      const before = (await rawRequest({ host: f.host, path: '/' })).body
      await page.getByRole('button', { name: 'Save draft', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Header & menu draft saved.' })).toBeVisible()
      expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before)
      await page.getByRole('link', { name: 'Publish…', exact: true }).click()
      await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
      await expect(page.getByLabel('Selected changes review', { exact: true })).toContainText(
        /pages checked, all ready/,
      )
      await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
      for (const path of ['/', '/visit'])
        expect((await rawRequest({ host: f.host, path })).body).toContain(
          'href="' + destination.replaceAll('&', '&amp;') + '"',
        )
    }
    expect(
      (
        await f.pool.query(
          "SELECT g.kind,g.use_on_live,d.content AS draft,l.content AS live FROM global_elements g JOIN global_element_versions d ON d.id=g.draft_version_id LEFT JOIN global_element_versions l ON l.id=g.published_version_id WHERE g.site_id=$1 AND g.kind='footer'",
          [f.site],
        )
      ).rows,
    ).toEqual(baseline.footer)
    expect(
      (
        await f.pool.query(
          'SELECT n.mode,d.tree AS draft,l.tree AS live FROM navigations n JOIN navigation_versions d ON d.id=n.draft_version_id LEFT JOIN navigation_versions l ON l.id=n.published_version_id WHERE n.site_id=$1',
          [f.site],
        )
      ).rows,
    ).toEqual(baseline.menu)
    expect(
      (
        await f.pool.query(
          'SELECT p.id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 ORDER BY p.id',
          [f.site],
        )
      ).rows,
    ).toEqual(baseline.content)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
