import { E2E_PORTS } from '../../test-ports.ts'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { test, expect, type Page } from '@playwright/test'
import { executeReleaseSchedule } from '../../../apps/worker/src/release-schedules.ts'
import { rawRequest } from '../http.ts'
import { signIn } from '../helpers.ts'
const folder = resolve('../.r8-progress/step-4/publishing')
async function capture(page: Page, name: string) {
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.evaluate(
      () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
function database() {
  return new Pool({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
}
async function jobScroll(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded()
}
async function fixture() {
  const pool = database(),
    client = await pool.connect(),
    suffix = randomUUID().slice(0, 8),
    workerId = 'r8-release-' + suffix
  let released = false
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const base = (
      await client.query(
        "SELECT v.tokens FROM themes h JOIN sites s ON s.id=h.site_id JOIN theme_versions v ON v.id=h.published_version_id WHERE s.slug='demo'",
      )
    ).rows[0]!.tokens
    const host = 'r8-publish-' + suffix + '.staging.localhost'
    const site = (
      await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'r8-publish-' + suffix,
        'Publish review site',
        'resource',
        host,
        JSON.stringify({ ...base, colors: { ...base.colors, primary: '#1f4e79' } }),
        '[]',
      ])
    ).rows[0]!.id
    for (const [email, role] of [
      ['editor@example.test', 'editor'],
      ['contributor@example.test', 'contributor'],
    ]) {
      const user = (await client.query('SELECT id FROM app_users WHERE email=$1', [email])).rows[0]!.id
      await client.query('SELECT app.set_site_membership($1,$2,$3)', [user, site, role])
    }
    const def = (
      await client.query(
        "SELECT d.id,max(v.version) AS current_version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    const title = 'Reviewed workspace page ' + suffix
    const id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, '', title])).rows[0]!.id
    const content = (heading: string) =>
      JSON.stringify([
        {
          section_def_id: def.id,
          section_def_version: Number(def.current_version),
          values: { heading, intro: 'A local release with a page, list and shared appearance.' },
          hidden: false,
          hidden_at: [],
          label: 'Hero',
        },
      ])
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      id,
      content('Before the reviewed release'),
      JSON.stringify({ description: 'A complete local page used for the Publish workspace review.' }),
    ])
    await client.query('SELECT app.publish_theme($1,1)', [site])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [site])
    await client.query("SELECT app.publish_page($1,1,3,NULL,'[]')", [id])
    const nav = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [site])).rows[0]!
    await client.query('SELECT app.publish_navigation($1,$2)', [site, nav.revision])
    await client.query('SELECT app.save_page_draft($1,2,$2,$3)', [
      id,
      content('After the reviewed release'),
      JSON.stringify({ description: 'A complete local page used for the Publish workspace review.' }),
    ])
    const theme = (
      await client.query(
        'SELECT h.revision,v.tokens FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [site],
      )
    ).rows[0]!
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
      site,
      theme.revision,
      JSON.stringify({ ...theme.tokens, colors: { ...theme.tokens.colors, primary: '#165b43' } }),
    ])
    const list = (
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        site,
        'r8-list-' + suffix,
        'Reviewed speakers ' + suffix,
        'r8_' + suffix,
        JSON.stringify([
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'role', label: 'Role', type: 'text', required: false },
        ]),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: 'role',
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!
    await client.query('SELECT app.save_collection_entries($1,0,$2)', [
      list.collection_id,
      JSON.stringify([
        { id: null, stableKey: 'presenter-1', values: { name: '[Presenter] (sample)', role: 'Presenter' } },
      ]),
    ])
    await client.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      workerId,
    ])
    await client.query('COMMIT')
    return { pool, siteId: site, pageId: id, host, path: '/', title, workerId, listId: list.collection_id }
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
test('revision 8 Publish: grouped choices, visual comparisons, real scheduled release and history', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const f = await fixture(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.siteId}/publishing`)
    await expect(page.getByRole('tab', { name: 'Changes ready to publish', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    for (const name of ['What', 'What changed', 'Who', 'When'])
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible()
    for (const checkbox of await page.getByRole('tabpanel').getByRole('checkbox').all())
      if (await checkbox.isEnabled()) await expect(checkbox).toBeChecked()
    await capture(page, 'grouped-changes')
    const row = page
      .getByRole('table', { name: 'Saved changes ready to publish', exact: true })
      .getByRole('row')
      .filter({ has: page.getByRole('checkbox', { name: new RegExp(f.title) }) })
    await row.getByRole('button', { name: 'View changes', exact: true }).click()
    const compare = page.getByRole('dialog', { name: 'Changes to ' + f.title, exact: true })
    await expect(compare.frameLocator('iframe[title="Live page"]').locator('h1')).toHaveText(
      'Before the reviewed release',
    )
    await expect(compare.frameLocator('iframe[title="Saved page"]').locator('h1')).toHaveText(
      'After the reviewed release',
    )
    await capture(page, 'page-side-by-side-desktop')
    await compare.getByRole('button', { name: 'Phone', exact: true }).click()
    await capture(page, 'page-side-by-side-phone')
    await compare.getByRole('button', { name: 'Done', exact: true }).click()
    await page
      .getByRole('table', { name: 'Saved changes ready to publish', exact: true })
      .getByRole('row')
      .filter({ has: page.getByRole('checkbox', { name: 'Colours, fonts and buttons', exact: true }) })
      .getByRole('button', { name: 'View changes', exact: true })
      .click()
    const look = page.getByRole('dialog')
    await expect(look.frameLocator('iframe[title="Saved page"]').locator('h1')).toBeVisible()
    await capture(page, 'site-look-before-after')
    await look.getByRole('button', { name: 'Done', exact: true }).click()
    const listGroup = page
      .getByRole('table', { name: 'Saved changes ready to publish', exact: true })
      .getByRole('row')
      .filter({ has: page.getByRole('checkbox', { name: / · items$/ }) })
    await listGroup.getByRole('button', { name: 'View changes', exact: true }).last().click()
    await expect(page.getByRole('dialog')).toContainText('[Presenter] (sample)')
    await capture(page, 'list-before-after')
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await expect(page.getByLabel('Selected changes review')).toBeVisible()
    const pageChoice = page.getByRole('checkbox', { name: new RegExp(f.title) })
    await pageChoice.uncheck()
    await expect(page.getByLabel('Selected changes review')).toHaveCount(0)
    await pageChoice.check()
    await page.getByRole('button', { name: 'Publish later…', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Publish later', exact: true })
    await expect(drawer.getByRole('button', { name: 'Schedule selected changes', exact: true })).toBeDisabled()
    await capture(page, 'schedule-empty')
    await drawer.getByLabel(/Date and time/).fill('2026-01-01T09:00')
    await drawer.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(drawer.getByRole('alert')).toContainText('choose a time at least a minute')
    await drawer.getByRole('alert').scrollIntoViewIfNeeded()
    await capture(page, 'schedule-past-time-error')
    await drawer.getByRole('button', { name: 'Tomorrow 9:00 AM', exact: true }).click()
    await expect(drawer.getByLabel(/Date and time/)).not.toHaveValue('')
    await capture(page, 'schedule-tomorrow')
    await drawer.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(drawer).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Scheduling request saved.' })).toBeVisible()
    const jobs = (
      await f.pool.query(
        "SELECT s.id,s.status,s.item_id,r.snapshot FROM scheduled_actions s JOIN site_releases r ON r.id=s.item_id WHERE s.site_id=$1 AND s.item_type='release' ORDER BY s.created_at DESC",
        [f.siteId],
      )
    ).rows
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending')
    expect(jobs[0].snapshot.some((item: { type: string }) => item.type === 'page')).toBe(true)
    expect(jobs[0].snapshot.some((item: { type: string }) => item.type === 'collection_entries')).toBe(true)
    expect(jobs[0].snapshot.some((item: { type: string }) => item.type === 'theme')).toBe(true)
    await page.getByRole('tab', { name: 'Scheduled publishing', exact: true }).click()
    await jobScroll(page, '#schedule-' + jobs[0].id)
    await capture(page, 'scheduled-changes')
    const job = page.locator('#schedule-' + jobs[0].id)
    await job.getByRole('button', { name: 'Cancel schedule', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel schedule', exact: true }).click()
    await expect(job).toContainText('Status: cancelled')
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true')
    await capture(page, 'history-planned')
    await page.getByRole('tab', { name: 'In review', exact: true }).click()
    await capture(page, 'review-empty')
    expect(errors).toEqual([])
  } finally {
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [f.workerId])
    await f.pool.end()
  }
})

test('revision 8 Publish: a leased worker publishes the reviewed release through the local endpoint exactly once', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const f = await fixture()
  try {
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.siteId}/publishing`)
    expect(
      (
        await page.request.post('/api/internal/scheduled-release', { data: { id: randomUUID(), lease: randomUUID() } })
      ).status(),
    ).toBe(409)
    await page.getByRole('button', { name: 'Publish later…', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Publish later', exact: true })
    await drawer.getByRole('button', { name: 'Monday 9:00 AM', exact: true }).click()
    await drawer.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(drawer).toBeHidden()
    const job = (
      await f.pool.query(
        "SELECT id,item_id FROM scheduled_actions WHERE site_id=$1 AND item_type='release' AND status='pending' ORDER BY created_at DESC LIMIT 1",
        [f.siteId],
      )
    ).rows[0]!
    await f.pool.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second' WHERE id=$1", [job.id])
    const workerUrl = `postgres://cms_worker_app:devpassword@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`
    const workerPool = new Pool({ connectionString: workerUrl }),
      client = await workerPool.connect()
    let lease: string
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.worker_id',$1,true)", [f.workerId])
      const claimed = (await client.query('SELECT * FROM app.claim_scheduled_action(60)')).rows[0]!
      expect(claimed.id).toBe(job.id)
      lease = claimed.lease_token
      await client.query('COMMIT')
    } finally {
      client.release()
      await workerPool.end()
    }
    await executeReleaseSchedule(job.id, lease!, { origin: `http://127.0.0.1:${E2E_PORTS.admin}` })
    expect(
      (await f.pool.query('SELECT status,lease_token_hash FROM scheduled_actions WHERE id=$1', [job.id])).rows[0],
    ).toEqual({ status: 'succeeded', lease_token_hash: null })
    const live = await rawRequest({ host: f.host, path: f.path })
    expect(live.status).toBe(200)
    expect(live.body).toContain('After the reviewed release')
    expect(
      (await page.request.post('/api/internal/scheduled-release', { data: { id: job.id, lease: lease! } })).status(),
    ).toBe(409)
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE item_id=$1 AND action='release.publish'",
          [job.item_id],
        )
      ).rows[0].count,
    ).toBe(1)
    await page.goto(`/sites/${f.siteId}/publishing?tab=history`)
    await page
      .getByRole('tabpanel')
      .getByRole('listitem')
      .filter({ has: page.getByText('Went live', { exact: true }) })
      .first()
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await page
      .getByLabel('Selected changes review', { exact: true })
      .locator('summary')
      .filter({ hasText: /^Checked pages/ })
      .click()
    await expect(page.getByRole('link', { name: 'Restore this version as a draft', exact: true }).first()).toBeVisible()
    await capture(page, 'history-applied-details')
  } finally {
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [f.workerId])
    await f.pool.end()
  }
})

test('revision 8 Publish: readiness fixes open the exact field, samples require consent and Contributors cannot publish', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const f = await fixture()
  try {
    const client = await f.pool.connect()
    try {
      await client.query('BEGIN')
      const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0].id
      await client.query("SELECT set_config('app.user_id',$1,true)", [root])
      const row = (
        await client.query(
          'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pageId],
        )
      ).rows[0]
      row.content[0].values.__cms_sample_fields = ['heading']
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        f.pageId,
        row.revision,
        JSON.stringify(row.content),
        '{}',
      ])
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.siteId}/publishing`)
    for (const checkbox of await page.getByRole('tabpanel').getByRole('checkbox').all())
      if (await checkbox.isEnabled()) await checkbox.uncheck()
    await page.getByRole('checkbox', { name: new RegExp(f.title) }).check()
    await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: /Publish with sample content/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish selected (1)', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).scrollIntoViewIfNeeded()
    await capture(page, 'readiness-samples-unconfirmed')
    const fix = page.locator(`a[href="/pages/${f.pageId}?settings=1&focus=description"]`)
    await fix.click()
    const settings = page.getByRole('dialog', { name: 'Page settings', exact: true })
    await expect(settings).toBeVisible()
    await expect(settings.getByLabel('Search description', { exact: true })).toBeFocused()
    await expect(settings.getByLabel('Search description', { exact: true })).toBeInViewport({ ratio: 1 })
    await expect(settings.getByRole('button', { name: 'Save page details', exact: true })).toBeAttached()
    await expect(settings.getByLabel('Search description', { exact: true })).toBeInViewport({ ratio: 1 })
    await expect(settings.getByRole('button', { name: 'Close Page settings', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await capture(page, 'readiness-description-field')
    await page.goto(`/sites/${f.siteId}/publishing`)
    for (const checkbox of await page.getByRole('tabpanel').getByRole('checkbox').all())
      if (await checkbox.isEnabled()) await checkbox.uncheck()
    await page.getByRole('checkbox', { name: new RegExp(f.title) }).check()
    await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    await page.locator(`a[href="/pages/${f.pageId}?section=0&field=heading"]`).click()
    await expect(page.locator('[data-inspector-slot="heading"][data-selected="true"]')).toBeVisible()
    await capture(page, 'readiness-sample-field')
    await page.goto(`/sites/${f.siteId}/publishing`)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await signIn(page, 'contributor@example.test')
    await page.goto(`/sites/${f.siteId}/publishing`)
    await expect(page.getByRole('button', { name: /^Publish selected/ })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'In review', exact: true })).toHaveCount(0)
    await capture(page, 'contributor-publish-permissions')
  } finally {
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [f.workerId])
    await f.pool.end()
  }
})

test('revision 8 Publish: a changed comparison refuses old pins and refreshes without exposing a newer draft under an old row', async ({
  page,
}) => {
  test.setTimeout(90000)
  page.setDefaultTimeout(10000)
  const f = await fixture()
  try {
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.siteId}/publishing`)
    const client = await f.pool.connect()
    try {
      await client.query('BEGIN')
      const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0].id
      await client.query("SELECT set_config('app.user_id',$1,true)", [root])
      const head = (
        await client.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pageId],
        )
      ).rows[0]
      head.content[0].values.heading = 'Newest reviewed heading'
      head.content[0].values.intro = 'A newer complete introduction.'
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        f.pageId,
        head.revision,
        JSON.stringify(head.content),
        JSON.stringify(head.meta),
      ])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    await page
      .getByRole('table', { name: 'Saved changes ready to publish', exact: true })
      .getByRole('row')
      .filter({ has: page.getByRole('checkbox', { name: new RegExp(f.title) }) })
      .getByRole('button', { name: 'View changes', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Changes unavailable', exact: true })).toBeVisible()
    await expect(dialog.locator('iframe')).toHaveCount(0)
    await capture(page, 'comparison-stale-error')
    await dialog.getByRole('button', { name: 'Refresh Publish', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Hero: changed heading · Hero: changed intro', { exact: true })).toBeVisible()
    await page
      .getByRole('table', { name: 'Saved changes ready to publish', exact: true })
      .getByRole('row')
      .filter({ has: page.getByRole('checkbox', { name: new RegExp(f.title) }) })
      .getByRole('button', { name: 'View changes', exact: true })
      .click()
    await expect(page.getByRole('dialog').frameLocator('iframe[title="Saved page"]').locator('h1')).toHaveText(
      'Newest reviewed heading',
    )
  } finally {
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [f.workerId])
    await f.pool.end()
  }
})

test('related-page publication reviews every sample and excludes unrelated private drafts', async ({ page }) => {
  test.setTimeout(120000)
  const { relatedPublishFixture } = await import('./fixtures/r8-related-publish.ts'),
    f = await relatedPublishFixture()
  try {
    await signIn(page, 'root@example.test')
    await page.goto(`/pages/${f.pages[0]}`)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Publish this page', exact: true })
      .getByRole('button', { name: 'Publish', exact: true })
      .click()
    const related = page.getByRole('link', { name: 'Review related changes in Publish', exact: true })
    await expect(related).toBeVisible()
    await capture(page, 'editor-related-review')
    await related.click()
    await expect(page).toHaveURL(/\/publishing\?pages=/)
    const pages = page.getByRole('table', { name: 'Saved changes ready to publish', exact: true })
    await expect(pages.getByRole('checkbox', { name: /Home for review/ })).toBeChecked()
    await expect(pages.getByRole('checkbox', { name: /Resources for review/ })).toBeChecked()
    await expect(pages.getByRole('checkbox', { name: /Unrelated private notes/ })).not.toBeChecked()
    await capture(page, 'related-pages-selected')
    await page.getByRole('button', { name: /^Publish selected \(/ }).click()
    const review = page.getByLabel('Selected changes review', { exact: true })
    await expect(review.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeFocused()
    await expect(review.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeInViewport()
    await expect(review).toContainText('Resources for review')
    await expect(review).toContainText('sample content')
    await expect(review.getByRole('button', { name: /^Publish selected \(/ })).toBeDisabled()
    await capture(page, 'related-samples-review')
    await review.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await review.getByRole('button', { name: /^Publish selected \(/ }).click()
    await capture(page, 'publish-confirmation')
    await page
      .getByRole('alertdialog')
      .filter({ has: page.getByRole('heading', { name: 'Publish selected changes?', exact: true }) })
      .getByRole('button', { name: 'Publish selected', exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Release applied. The selected changes took effect together.' }),
    ).toBeVisible()
    expect((await rawRequest({ host: f.host, path: '/' })).status).toBe(200)
    expect((await rawRequest({ host: f.host, path: '/resources' })).status).toBe(200)
    expect((await rawRequest({ host: f.host, path: '/notes' })).status).toBe(404)
    const pointers = (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[2]])).rows[0]!
    expect(pointers.published_version_id).toBeNull()
  } finally {
    await f.pool.end()
  }
})
