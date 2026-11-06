import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { copySectionDraft } from '../../apps/admin/src/lib/section-tools-commands.ts'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn, publish } from './helpers.ts'
test('section link rename updates related drafts atomically and section copies land at the chosen place without duplicate link names', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    source = f.pages[1]!,
    destination = f.pages[0]!,
    folder = resolve('../.r8-progress/round3/symphony-sections/' + info.project.name)
  await mkdir(folder, { recursive: true })
  try {
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const prose = (
        await c.query(
          "SELECT d.id,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-text-block' ORDER BY v.version DESC LIMIT 1",
        )
      ).rows[0]!,
      cta = (
        await c.query(
          "SELECT d.id,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-cta-band' ORDER BY v.version DESC LIMIT 1",
        )
      ).rows[0]!,
      part = (label: string, body: string, anchor?: string) => ({
        section_def_id: prose.id,
        section_def_version: prose.version,
        label,
        values: { heading: label, body, ...(anchor ? { __cms_anchor: anchor } : {}) },
      })
    for (const id of [source, destination]) {
      const row = (
        await c.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!
      if (id === source)
        row.content.push(
          part('[Earlier content]', '<p>' + '[Earlier page content.] '.repeat(300) + '</p>'),
          part(
            '[Source details]',
            '<p>[Approved words] <a href="#visit-details">[Local jump]</a></p>',
            'visit-details',
          ),
        )
      else
        row.content.push(
          part(
            '[Destination details]',
            '<p><a href="/visit?view=all#visit-details">[Text jump]</a></p>',
            'care-details',
          ),
          {
            section_def_id: cta.id,
            section_def_version: cta.version,
            label: '[Button section]',
            values: {
              heading: '[Button heading]',
              intro: '[Button introduction]',
              action: { label: '[Button jump]', url: '/visit#visit-details' },
            },
          },
        )
      const saved = (
        await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          id,
          row.revision,
          JSON.stringify(row.content),
          JSON.stringify(row.meta),
        ])
      ).rows[0]!
      await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [id, saved.revision])
    }
    const heads = (
        await c.query(
          'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
          [f.site],
        )
      ).rows,
      header = heads.find(row => row.kind === 'header')!,
      footer = heads.find(row => row.kind === 'footer')!
    footer.content.groups.push({
      heading: '[Links]',
      links: [{ label: '[Footer jump]', target: { type: 'url', url: '/visit#visit-details' } }],
    })
    const frame = (
      await c.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5,true)', [
        f.site,
        header.revision,
        footer.revision,
        JSON.stringify(header.content),
        JSON.stringify(footer.content),
      ])
    ).rows[0]!
    await c.query('SELECT app.publish_global_elements($1,$2,$3)', [
      f.site,
      frame.header_revision,
      frame.footer_revision,
    ])
    const nav = (
      await c.query(
        'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [f.site],
      )
    ).rows[0]!
    nav.tree.push({ label: '[Menu jump]', target: { type: 'url', url: '/visit#visit-details' }, visible: true })
    const menu = (
      await c.query("SELECT * FROM app.save_navigation_draft($1,$2,$3,'manual')", [
        f.site,
        nav.revision,
        JSON.stringify(nav.tree),
      ])
    ).rows[0]!
    await c.query('SELECT app.publish_navigation($1,$2)', [f.site, menu.revision])
    const list = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        f.site,
        'linked-content',
        '[Related list]',
        'related_links',
        JSON.stringify([
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'body', label: 'Body', type: 'richtext', required: false },
          { key: 'website', label: 'Website', type: 'url', required: false },
        ]),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: null,
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!.collection_id
    const savedList = (
      await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
        list,
        JSON.stringify([
          {
            id: null,
            stableKey: 'linked-entry',
            values: {
              name: '[Linked entry]',
              body: '<p><a href="/visit#visit-details">[List jump]</a></p>',
              website: 'https://' + f.host + `:${E2E_PORTS.site}/visit#visit-details`,
            },
          },
        ]),
      ])
    ).rows[0]!
    await c.query('SELECT app.publish_collection_schema($1,1)', [list])
    await c.query('SELECT app.publish_collection_entries($1,$2)', [list, savedList.entry_revision])
    await c.query('COMMIT')
    const publicHeads = async () =>
        (
          await c.query(
            'SELECT id,published_version_id FROM pages WHERE site_id=$1 UNION ALL SELECT id,published_version_id FROM global_elements WHERE site_id=$1 UNION ALL SELECT id,published_version_id FROM navigations WHERE site_id=$1 ORDER BY id',
            [f.site],
          )
        ).rows,
      live = await publicHeads(),
      capture = async (name: string) => {
        await expect(page.getByText('Updating page preview…', { exact: true })).toHaveCount(0)
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + source + '?section=2')
    await page.getByRole('button', { name: 'More section actions', exact: true }).click()
    await page.getByRole('button', { name: 'Change link name', exact: true }).click()
    let panel = page.getByRole('complementary', { name: 'Section tools', exact: true })
    await expect(panel.getByLabel('Link name', { exact: true })).toHaveValue('visit-details')
    await expect(panel).toContainText('7 links lead here now')
    if (info.project.name === 'chromium')
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
    await panel.getByRole('button', { name: 'Copy link', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('Section link copied')
    if (info.project.name === 'chromium')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        'http://' + f.host + `:${E2E_PORTS.site}/visit#visit-details`,
      )
    await panel.getByLabel('Link name', { exact: true }).fill('discarded-name')
    await panel.getByRole('button', { name: 'Back to section', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(panel.getByLabel('Link name', { exact: true })).toHaveValue('discarded-name')
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(panel).toHaveCount(0)
    expect(await publicHeads()).toEqual(live)
    await page.getByRole('button', { name: 'More section actions', exact: true }).click()
    await page.getByRole('button', { name: 'Change link name', exact: true }).click()
    panel = page.getByRole('complementary', { name: 'Section tools', exact: true })
    await expect(panel.getByLabel('Link name', { exact: true })).toHaveValue('visit-details')
    await capture('link-name')
    const sourceBefore = (await c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [source])).rows[0]!
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const changed = (
      await c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [destination],
      )
    ).rows[0]!
    changed.content[1].values.body += '<p>[Concurrent paragraph]</p>'
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      destination,
      changed.revision,
      JSON.stringify(changed.content),
      JSON.stringify(changed.meta),
    ])
    await c.query('COMMIT')
    await panel.getByLabel('Link name', { exact: true }).fill('care-details')
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('A linked draft changed')
    expect((await c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [source])).rows[0]).toEqual(
      sourceBefore,
    )
    expect(await publicHeads()).toEqual(live)
    await capture('linked-draft-conflict')
    await panel.getByRole('button', { name: 'Reload this step', exact: true }).click()
    await expect(panel.getByLabel('Link name', { exact: true })).toHaveValue('care-details')
    await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('7 linked destinations were updated as drafts')
    await capture('renamed-drafts')
    expect(await publicHeads()).toEqual(live)
    const sourceDraft = (
        await c.query('SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
          source,
        ])
      ).rows[0]!.content,
      targetDraft = (
        await c.query('SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
          destination,
        ])
      ).rows[0]!.content
    expect(sourceDraft[2].values.__cms_anchor).toBe('care-details')
    expect(sourceDraft[2].values.__cms_anchor_aliases).toEqual(['visit-details'])
    expect(sourceDraft[2].values.body).toContain('href="#care-details"')
    expect(targetDraft[1].values.body).toContain('[Concurrent paragraph]')
    expect(targetDraft[1].values.body).toContain('/visit?view=all#care-details')
    expect(targetDraft[2].values.action.url).toBe('/visit#care-details')
    for (const table of ['global_elements', 'navigations']) {
      const config = (
        await c.query(
          table === 'navigations'
            ? 'SELECT v.tree AS value FROM navigations h JOIN navigation_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1'
            : "SELECT v.content AS value FROM global_elements h JOIN global_element_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1 AND h.kind='footer'",
          [f.site],
        )
      ).rows[0]!.value
      expect(JSON.stringify(config)).toContain('/visit#care-details')
    }
    const entry = (
      await c.query(
        'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
        [list],
      )
    ).rows[0]!.values
    expect(entry.body).toContain('/visit#care-details')
    expect(entry.website).toBe('https://' + f.host + `:${E2E_PORTS.site}/visit#care-details`)
    await panel.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible()
    await page.goto('/sites/' + f.site + '/publishing')
    const ready = page.getByRole('region', { name: 'Changes ready to publish', exact: true })
    await expect(ready).toContainText('Menu: changed where [Menu jump] goes')
    await expect(ready).toContainText('Footer: changed where [Footer jump] goes')
    await capture('named-related-drafts')
    await page.goto('/pages/' + destination)
    const waiting = page.getByText(
      'A link points to a section waiting to be published on /visit. Publish these pages together, or choose another destination.',
      { exact: true },
    )
    await expect(waiting).toHaveCount(2)
    await expect(waiting.first()).toBeVisible()
    await capture('referring-page-needs-target')
    await page.goto('/pages/' + source + '?section=2')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Publish this page', exact: true })
    await expect(review).toContainText('changed the section link name to care-details')
    await review.getByRole('button', { name: 'Cancel', exact: true }).click()
    await publish(page)
    const oldLinks = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } })
    try {
      const p = await oldLinks.newPage()
      await p.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
      await p.getByRole('link', { name: '[Button jump]', exact: true }).click()
      await expect(p).toHaveURL(/\/visit#visit-details$/)
      await expect(p.getByRole('heading', { name: '[Source details]', exact: true })).toBeInViewport()
      expect(await p.evaluate(() => scrollY)).toBeGreaterThan(500)
      await p.screenshot({ path: resolve(folder, 'old-public-link-no-script-390.png') })
    } finally {
      await oldLinks.close()
    }
    await page.goto('/pages/' + destination + '?section=2')
    await publish(page)
    const visitor = await browser.newContext()
    try {
      const p = await visitor.newPage()
      for (const width of [1440, 1024, 390]) {
        await p.setViewportSize({ width, height: 900 })
        await p.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
        await p.getByRole('link', { name: '[Button jump]', exact: true }).click()
        await expect(p).toHaveURL(/\/visit#care-details$/)
        await expect(p.getByRole('heading', { name: '[Source details]', exact: true })).toBeInViewport()
        expect(await p.evaluate(() => scrollY)).toBeGreaterThan(500)
        await p.screenshot({ path: resolve(folder, 'new-public-link-' + width + '.png') })
      }
    } finally {
      await visitor.close()
    }
    await page.goto('/pages/' + source + '?section=2')
    await page.getByRole('button', { name: 'More section actions', exact: true }).click()
    await page.getByRole('button', { name: 'Copy to another page', exact: true }).click()
    panel = page.getByRole('complementary', { name: 'Section tools', exact: true })
    await panel.getByLabel('Page', { exact: true }).selectOption(destination)
    await panel.getByLabel('Where on that page', { exact: true }).selectOption('1')
    await capture('copy-place')
    const targetBefore = (
        await c.query('SELECT draft_version_id,published_version_id FROM pages WHERE id=$1', [destination])
      ).rows[0]!,
      foreign = (
        await c.query(
          "SELECT p.id,p.draft_version_id,p.published_version_id FROM pages p JOIN sites s ON s.id=p.site_id WHERE s.slug='demo' ORDER BY p.id LIMIT 1",
        )
      ).rows[0]!,
      route = '**/pages/' + source + '*'
    let tampered = false
    await page.route(route, async r => {
      const data = r.request().postData()
      if (r.request().method() === 'POST' && data?.includes('targetPageId')) {
        tampered = true
        await r.continue({ postData: data.replaceAll(destination, foreign.id) })
      } else await r.continue()
    })
    await panel.getByRole('button', { name: 'Copy section', exact: true }).click()
    await expect.poll(() => tampered).toBe(true)
    await expect(panel.getByRole('alert')).toContainText('Choose another ordinary page on this site')
    expect(
      (await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE id=$1', [foreign.id])).rows[0],
    ).toEqual(foreign)
    expect(
      (await c.query('SELECT draft_version_id,published_version_id FROM pages WHERE id=$1', [destination])).rows[0],
    ).toEqual(targetBefore)
    await page.unroute(route)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const newer = (
      await c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [destination],
      )
    ).rows[0]!
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      destination,
      newer.revision,
      JSON.stringify(newer.content),
      JSON.stringify({ ...newer.meta, description: '[Concurrent destination description]' }),
    ])
    await c.query('COMMIT')
    const newerHead = (await c.query('SELECT draft_version_id FROM pages WHERE id=$1', [destination])).rows[0]!
      .draft_version_id
    await panel.getByRole('button', { name: 'Copy section', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('The destination page changed')
    expect(
      (await c.query('SELECT draft_version_id FROM pages WHERE id=$1', [destination])).rows[0]!.draft_version_id,
    ).toBe(newerHead)
    await panel.getByRole('button', { name: 'Reload this step', exact: true }).click()
    await expect(panel.getByLabel('Where on that page', { exact: true })).toHaveValue('')
    await panel.getByLabel('Where on that page', { exact: true }).selectOption('1')
    await panel.getByRole('button', { name: 'Copy section', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('as a draft. Nothing was published')
    await capture('copied')
    const after = (
      await c.query(
        'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [destination],
      )
    ).rows[0]!
    expect(after.published_version_id).toBe(targetBefore.published_version_id)
    expect(after.content).toHaveLength(4)
    expect(after.content[1].values.__cms_anchor).toBe('care-details-2')
    expect(after.content[1].values.__cms_anchor_aliases).toBeUndefined()
    expect(after.content[1].values.body).toContain('href="#care-details-2"')
    expect(after.content[2]).toEqual(targetDraft[1])
    expect(after.content[3]).toEqual(targetDraft[2])
    await panel.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(panel).toHaveCount(0)
    const editor = (await c.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id,
      copySource = (await c.query('SELECT revision::text,draft_version_id FROM pages WHERE id=$1', [source])).rows[0]!,
      destinationRevision = (await c.query('SELECT revision::text FROM pages WHERE id=$1', [destination])).rows[0]!
        .revision,
      protectedHeads = (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [editor])
    await expect(
      copySectionDraft(c, {
        pageId: source,
        versionId: copySource.draft_version_id,
        revision: copySource.revision,
        index: 2,
        targetPageId: destination,
        targetRevision: destinationRevision,
        at: 0,
      }),
    ).rejects.toThrow('A Site admin manages')
    await c.query('ROLLBACK')
    expect(
      (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(protectedHeads)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
