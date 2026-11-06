import { setPreviewSiteLook } from './helpers.ts'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { e2eTarget } from '../test-target.ts'
import { canvas, signIn } from './helpers.ts'

// Which site appearance the page editor opens with. A live site shows what
// visitors see; a site with no page live yet has no visitor appearance, so an
// older or imported site's published frame is only a creation-time placeholder
// and the editor opens on the saved header, footer, navigation and design.
test('a live site opens on its published appearance', async ({ page }) => {
  await signIn(page, 'root@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(canvas(page).locator('h1')).toBeVisible()
  await expect(page.getByLabel('Preview with saved site-look changes', { exact: true })).not.toBeChecked()
})

test('a site with nothing live opens on its saved appearance instead of a placeholder frame', async ({ page }) => {
  const target = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
  await client.connect()
  let pageId = ''
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const hero = (await client.query("SELECT id FROM section_defs WHERE slug='hero' AND scope='global'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const siteId = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        `appearance-default-${Date.now()}`,
        'Appearance default fixture',
        'resource',
        null,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    // The state an older or imported site is in: a published starter frame,
    // a newer saved frame, and no page published yet.
    await client.query('SELECT app.publish_theme($1,1)', [siteId])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [siteId])
    await client.query('SELECT app.publish_navigation($1,1)', [siteId])
    const heads = (
      await client.query(
        'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [siteId],
      )
    ).rows
    const header = heads.find(row => row.kind === 'header')!,
      footer = heads.find(row => row.kind === 'footer')!
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      siteId,
      header.revision,
      footer.revision,
      JSON.stringify({ ...header.content, brand: { ...header.content.brand, siteName: 'Saved source frame' } }),
      JSON.stringify(footer.content),
    ])
    pageId = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, '', 'Appearance default page']))
      .rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: hero,
          section_def_version: 1,
          values: { heading: 'Nothing live yet', intro: 'Only saved drafts so far.' },
          hidden: false,
          hidden_at: [],
          label: 'Hero',
        },
      ]),
      '{}',
    ])
    await client.query('COMMIT')
    await client.query('UPDATE sites SET initial_release_required=false WHERE id=$1', [siteId])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }

  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${pageId}`)
  await expect(page.getByLabel('Preview with saved site-look changes', { exact: true })).toBeChecked()
  await expect(canvas(page).getByText('Saved source frame', { exact: true }).first()).toBeVisible()
  // Choosing the published settings still works and is honest about them.
  await setPreviewSiteLook(page, 'published')
  await expect(canvas(page).getByText('Saved source frame', { exact: true })).toHaveCount(0)
})
