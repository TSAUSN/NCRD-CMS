import { test, expect } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('Admin Home shows saved attention, immediate authenticated pictures and recent work without rendering whole pages', async ({
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    suffix = randomUUID().slice(0, 8),
    email = 'home-admin-' + suffix + '@example.test',
    siteName = '! 000 Home preview ' + suffix,
    folder = resolve('../.r8-progress/round3/admin-home/' + info.project.name)
  let sourceReads = 0,
    user: string | undefined
  try {
    await mkdir(folder, { recursive: true })
    const c = await f.pool.connect()
    try {
      await c.query('BEGIN')
      // Pinned sites come first, then the alphabetical remainder. Other
      // browser fixtures can remain active and sort ahead of an A prefix.
      await c.query('UPDATE sites SET name=$2 WHERE id=$1', [f.site, siteName])
      const root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query("SELECT set_config('app.user_id',$1,true)", [root])
      const bytes = await readFile(resolve('../apps/site/public/cms-samples/r8-landscape.png'))
      await createFilesystemMediaStore(defaultMediaRoot()).put('r8-look/' + f.picture, bytes, 'image/png')
      await c.query('UPDATE media SET content_hash=$2,bytes=$3,width=1280,height=720 WHERE id=$1', [
        f.picture,
        createHash('sha256').update(bytes).digest('hex'),
        bytes.length,
      ])
      const slug = 'home-picture-' + randomUUID().slice(0, 8),
        slots = [
          { id: 'heading', kind: 'text' as const, label: 'Heading', constraints: {} },
          { id: 'photo', kind: 'image' as const, label: 'Photo', constraints: {} },
        ]
      const source = '<section><h1>{{heading}}</h1><img src="{{photo}}" alt="{{photo}}"></section>'
      const compiled = compileSection({ sourceHtml: source, slots, scopeSelector: sectionScopeSelector(slug)! })
      const def = (
        await c.query(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            slug,
            'Saved home picture',
            'Original',
            source,
            '',
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            'Home preview fixture',
            false,
            'legacy',
            null,
            null,
            'site',
            f.site,
          ],
        )
      ).rows[0]!.section_def_id
      const head = (
        await c.query(
          'SELECT p.revision,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!
      const saved = (
        await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          f.pages[0],
          head.revision,
          JSON.stringify([
            {
              section_def_id: def,
              section_def_version: 1,
              values: {
                heading: 'Welcome',
                photo: { media_id: f.picture, variant: 'original', alt: 'Saved home picture' },
              },
              hidden: false,
            },
          ]),
          JSON.stringify(head.meta),
        ])
      ).rows[0]!
      await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], saved.revision])
      user = (await c.query('SELECT app.provision_user($1,$2) AS id', [email, '[Admin account]'])).rows[0]!.id
      await c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [user, f.site])
      await c.query('UPDATE app_users SET auth_subject=$1 WHERE id=$2', ['local|' + email, user])
      await c.query('COMMIT')
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    } finally {
      c.release()
    }
    const before = (
      await f.pool.query(
        'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=$1 ORDER BY id',
        [f.site],
      )
    ).rows
    for (const account of [
      { email, role: 'siteadmin' },
      { email: 'root@example.test', role: 'superadmin' },
    ]) {
      const context = await browser.newContext()
      try {
        const page = await context.newPage(),
          errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.route(/https:\/\/(www\.)?sawso\.org\//, async route => {
          sourceReads++
          await route.abort()
        })
        await signIn(page, account.email)
        const main = page.getByRole('main')
        await expect(main.getByRole('heading', { name: 'Home', exact: true, level: 1 })).toBeVisible()
        await expect(main.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
        await expect(main.getByRole('heading', { name: 'Needs you', exact: true })).toBeVisible()
        await expect(main.getByRole('heading', { name: 'Your sites', exact: true })).toBeVisible()
        await expect(main.getByRole('heading', { name: 'Jump back in', exact: true })).toBeVisible()
        await expect(main.getByRole('link', { name: 'Create a site', exact: true })).toHaveCount(
          account.role === 'superadmin' ? 1 : 0,
        )
        const image = main.getByRole('img', { name: siteName + ' saved home-page picture', exact: true })
        const imageAddress = '/media/' + f.picture + '/original'
        await expect(image).toHaveAttribute('src', imageAddress)
        await expect
          .poll(() =>
            image.evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
          )
          .toBe(true)
        await expect(main.locator('iframe')).toHaveCount(0)
        await expect(main.getByText('Loading saved preview…', { exact: true })).toHaveCount(0)
        await page.evaluate(() => scrollTo(0, 0))
        if (account.role === 'siteadmin') {
          await expect(main.getByText('Nothing needs your attention', { exact: true })).toBeVisible()
          await expect(main.getByText('Background jobs', { exact: true })).toHaveCount(0)
        } else {
          await expect(main.getByText('Test tools (this computer only)', { exact: true })).toBeVisible()
          await expect(main.getByText('The worker is not running', { exact: true })).not.toBeVisible()
        }
        for (const width of [1440, 1024, 390]) {
          await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 })
          await page.evaluate(() => document.fonts.ready)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          if (account.role === 'superadmin') {
            const rows = main.locator('[data-attention-site]')
            expect(await rows.count()).toBeGreaterThan(0)
            for (const row of await rows.all()) {
              const copy = await row.locator('strong').evaluate(node => {
                  const box = node.parentElement!.getBoundingClientRect()
                  return { width: box.width, bottom: box.bottom }
                }),
                action = await row.getByRole('link').boundingBox()
              expect(copy.width).toBeGreaterThanOrEqual(160)
              if (width === 390) expect(action!.y).toBeGreaterThanOrEqual(copy.bottom)
            }
          }
          await page.screenshot({ path: resolve(folder, account.role + '-' + width + '.png'), animations: 'disabled' })
        }
        if (account.role === 'superadmin') {
          await main.getByText('Test tools (this computer only)', { exact: true }).click()
          await expect(main.getByText('The worker is not running', { exact: true })).toBeVisible()
          await main.getByText('Test tools (this computer only)', { exact: true }).click()
        }
        await main.getByText('More tasks', { exact: true }).click()
        await expect(main.getByRole('heading', { name: 'What would you like to do?', exact: true })).toBeVisible()
        const tasks = main.getByRole('region', { name: 'What would you like to do?', exact: true })
        const homeShortcut = tasks.getByRole('link').filter({ hasText: 'Edit ' + siteName + ' home page' })
        await expect(homeShortcut).toHaveAttribute('href', '/pages/' + f.pages[0])
        if (account.role === 'siteadmin') {
          await page.route('**' + imageAddress, route =>
            route.fulfill({ status: 503, contentType: 'image/png', body: '' }),
          )
          await page.reload()
          await expect(main.getByText('Preview unavailable · Open site', { exact: true })).toBeVisible()
          await expect(main.locator('iframe')).toHaveCount(0)
          for (const width of [1440, 1024]) {
            await page.setViewportSize({ width, height: 900 })
            await page.screenshot({ path: resolve(folder, 'preview-error-' + width + '.png'), animations: 'disabled' })
          }
          await page.unroute('**' + imageAddress)
          await page.reload()
          await expect(
            main.getByRole('img', { name: siteName + ' saved home-page picture', exact: true }),
          ).toHaveAttribute('src', imageAddress)
          await expect(main.getByText('Preview unavailable · Open site', { exact: true })).toHaveCount(0)
        }
        await main.getByRole('link', { name: 'Open ' + siteName, exact: true }).click()
        await expect(page).toHaveURL('/sites/' + f.site)
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    }
    expect(
      (
        await f.pool.query(
          'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=$1 ORDER BY id',
          [f.site],
        )
      ).rows,
    ).toEqual(before)
    expect(sourceReads).toBe(0)
  } finally {
    if (user) await f.pool.query('DELETE FROM site_memberships WHERE site_id=$1 AND user_id=$2', [f.site, user])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
