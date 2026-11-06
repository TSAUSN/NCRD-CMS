import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn, saveDraft, publish } from './helpers.ts'
import { processMediaBytes } from '../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
test('Symphony hero controls use normal drafts, separate button links, phone photos, timed slides and switched-off copies', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/symphony-hero/' + info.project.name)
  await mkdir(folder, { recursive: true })
  const c = await f.pool.connect()
  try {
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      hero = (
        await c.query(
          "SELECT d.id,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-feature-slider' ORDER BY v.version DESC LIMIT 1",
        )
      ).rows[0]!,
      photos: string[] = []
    for (const [file, name] of [
      ['r8-landscape.png', '[Wide photo].png'],
      ['r8-square.png', '[Phone photo].png'],
    ]) {
      const id = randomUUID(),
        bytes = await readFile(resolve('../apps/admin/public/cms-samples/' + file)),
        processed = await processMediaBytes(
          {
            intentId: randomUUID(),
            siteId: f.site,
            uploadObjectKey: 'hero-fixture/input.png',
            finalKeyPrefix: 'hero-fixture/' + id + '/',
            declaredMime: 'image/png',
            declaredBytes: bytes.length,
          },
          bytes,
        ),
        store = createFilesystemMediaStore(defaultMediaRoot()),
        original = processed.original
      await store.put(original.objectKey, original.data, original.mimeType)
      await c.query(
        "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,$5,'[Photo description]',$6,$7,$8,$9,'ready')",
        [
          id,
          f.site,
          original.objectKey,
          original.sha256,
          name,
          original.width,
          original.height,
          original.bytes,
          original.mimeType,
        ],
      )
      for (const variant of processed.variants) {
        await store.put(variant.objectKey, variant.data, variant.mimeType)
        await c.query(
          'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            variant.kind,
            variant.objectKey,
            variant.sha256,
            variant.width,
            variant.height,
            variant.bytes,
            variant.mimeType,
          ],
        )
      }
      photos.push(id)
    }
    const source = f.pages[0]!,
      destination = f.pages[1]!,
      before = (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const target = (
      await c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [destination],
      )
    ).rows[0]!
    const prose = (
      await c.query(
        "SELECT d.id,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-text-block' ORDER BY v.version DESC LIMIT 1",
      )
    ).rows[0]!
    target.content.push(
      {
        section_def_id: prose.id,
        section_def_version: prose.version,
        values: { heading: '[Earlier content]', body: '<p>' + '[Earlier page content.] '.repeat(300) + '</p>' },
      },
      {
        section_def_id: prose.id,
        section_def_version: prose.version,
        values: { heading: '[Visit details]', body: '<p>[Destination content]</p>', __cms_anchor: 'visit-details' },
      },
    )
    const targetSaved = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        destination,
        target.revision,
        JSON.stringify(target.content),
        JSON.stringify(target.meta),
      ])
    ).rows[0]!
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [destination, targetSaved.revision])
    const values: Record<string, unknown> = { heading: 'Welcome', slides: { items: ['i1', 'i2', 'i3'] } }
    for (let n = 1; n <= 3; n++)
      Object.assign(values, {
        ['slides__i' + n + '__title']: '[Slide ' + n + ']',
        ['slides__i' + n + '__intro']:
          n === 3 ? '[Existing approved words] '.repeat(12).slice(0, 230) : '[Slide introduction ' + n + ']',
        ['slides__i' + n + '__photo']: {
          src: '/media/' + photos[0] + '/wide',
          alt: '[Photo description]',
          decorative: false,
        },
        ['slides__i' + n + '__enabled']: 'on',
        ['slides__i' + n + '__primary']: { label: '[Go ' + n + ']', url: n === 2 ? '/visit#visit-details' : '/visit' },
        ['slides__i' + n + '__secondary']: { label: '', url: '' },
      })
    const head = (await c.query('SELECT revision FROM pages WHERE id=$1', [source])).rows[0]!
    const legacySource = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        source,
        head.revision,
        JSON.stringify([{ section_def_id: hero.id, section_def_version: hero.version, label: 'Hero slider', values }]),
        JSON.stringify({ description: '[Hero page description]' }),
      ])
    ).rows[0]!
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [source, legacySource.revision])
    await c.query('COMMIT')
    const initialSourceLive = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [source])).rows[0]!
      .published_version_id
    const capture = async (name: string) => {
        await expect(page.locator('.saved-state')).toContainText('All changes saved')
        await expect(page.locator('.canvas-loading')).toHaveCount(0)
        await expect(page.getByText('Updating page preview…', { exact: true })).toHaveCount(0)
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      },
      inspector = page.getByRole('complementary', { name: 'Inspector' }),
      frame = page.frameLocator('iframe[title="Page canvas"]')
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + source + '?section=0')
    await expect(inspector.locator('ol>li').first().locator('img')).toHaveAttribute(
      'src',
      '/media/' + photos[0] + '/thumbnail',
    )
    await inspector.getByRole('button', { name: '1. [Slide 1]', exact: true }).click()
    await expect(inspector.getByLabel('Title', { exact: true })).toHaveAttribute('maxlength', '100')
    await expect(inspector.getByLabel('Introduction', { exact: true })).toHaveAttribute('maxlength', '200')
    await inspector.getByLabel('Title', { exact: true }).fill('[Edited hero]')
    await inspector
      .getByRole('group', { name: 'Text position', exact: true })
      .getByRole('button', { name: 'Right', exact: true })
      .click()
    await inspector
      .getByRole('group', { name: 'Shade behind the text', exact: true })
      .getByRole('button', { name: 'White', exact: true })
      .click()
    await expect(frame.locator('[data-cms-hero-key="i1"]')).toHaveAttribute('data-hero-position', 'right')
    await expect(frame.locator('[data-cms-hero-key="i1"]')).toHaveAttribute('data-hero-shade', 'white')
    await expect(inspector.getByRole('checkbox', { name: /Different picture on phones/ })).toBeHidden()
    await inspector.locator('summary').filter({ hasText: 'Photo and crop' }).click()
    await inspector.getByRole('checkbox', { name: /Different picture on phones/ }).check()
    await inspector
      .locator('[data-inspector-slot="slides__i1__phone_photo"]')
      .getByRole('button', { name: 'Choose from media library', exact: true })
      .click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByRole('option').filter({ hasText: '[Phone photo].png' }).click()
    await picker.getByRole('button', { name: 'Use this image', exact: true }).click()
    await expect(picker).toHaveCount(0)
    const main = inspector.getByRole('region', { name: 'Main button', exact: true })
    await main.getByLabel('Button text', { exact: true }).fill('[Visit]')
    await main
      .getByRole('group', { name: 'Main button color', exact: true })
      .getByRole('button', { name: 'Outline', exact: true })
      .click()
    await main.getByRole('button', { name: 'Change', exact: true }).click()
    const link = page.getByRole('dialog', { name: 'Where does “[Visit]” go?', exact: true })
    await link.getByLabel('Page', { exact: true }).selectOption(destination)
    await link.getByLabel('Jump to a section (optional)', { exact: true }).selectOption('visit-details')
    await link.getByRole('checkbox', { name: 'Open in a new tab', exact: true }).check()
    await link.getByRole('checkbox', { name: 'Don’t recommend to search engines (nofollow)', exact: true }).check()
    await link.getByRole('button', { name: 'Use this link', exact: true }).click()
    await expect(main).toContainText('/visit#visit-details')
    await expect(
      frame.locator('[data-cms-hero-key="i1"]').getByRole('link', { name: '[Visit]', exact: true }),
    ).toHaveAttribute('href', '/visit#visit-details')
    await capture('edit-slide')
    await expect(inspector.getByLabel('Show from', { exact: true })).toHaveCount(0)
    await inspector.getByRole('checkbox', { name: 'Schedule this slide', exact: true }).check()
    await inspector.getByLabel('Show from', { exact: true }).fill('2099-11-27T06:00')
    await inspector.getByLabel('Show until', { exact: true }).fill('2099-12-31T23:59')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      expect((await inspector.getByLabel('Show from', { exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(
        250,
      )
      expect((await inspector.getByLabel('Show until', { exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(
        250,
      )
    }
    await capture('scheduled-slide')
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await inspector.getByRole('button', { name: 'Slide 1 actions', exact: true }).click()
    await inspector.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect(inspector.getByRole('button', { name: '2. [Edited hero]', exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: 'Slide 2 actions', exact: true }).click()
    await inspector.getByRole('button', { name: 'Remove slide 2', exact: true }).click()
    await expect(inspector.getByRole('button', { name: '2. [Slide 2]', exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: 'Slide 1 actions', exact: true }).click()
    await inspector.getByRole('button', { name: 'Copy to another page', exact: true }).click()
    const copy = page.getByRole('dialog', { name: 'Copy slide to another page', exact: true })
    await copy.getByLabel('Page', { exact: true }).selectOption(destination)
    await capture('copy-review')
    const foreign = (
        await c.query(
          "SELECT p.id,p.draft_version_id,p.published_version_id FROM pages p JOIN sites s ON s.id=p.site_id WHERE s.slug='demo' ORDER BY p.id LIMIT 1",
        )
      ).rows[0]!,
      tamper = '**/pages/' + source + '*'
    let tampered = false
    await page.route(tamper, async route => {
      const data = route.request().postData()
      if (route.request().method() === 'POST' && data?.includes('targetPageId')) {
        tampered = true
        await route.continue({ postData: data.replaceAll(destination, foreign.id) })
      } else await route.continue()
    })
    await copy.getByRole('button', { name: 'Copy slide', exact: true }).click()
    await expect.poll(() => tampered).toBe(true)
    await expect(copy.getByRole('alert')).toHaveText('Choose another page on this site that you can edit.')
    expect(
      (await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE id=$1', [foreign.id])).rows[0],
    ).toEqual(foreign)
    await page.unroute(tamper)
    await copy.getByRole('button', { name: 'Copy slide', exact: true }).click()
    await expect(copy.getByRole('status')).toContainText('as a draft, switched off')
    await copy.getByRole('button', { name: 'Done', exact: true }).click()
    await saveDraft(page)
    const saved = (
        await c.query(
          'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [source],
        )
      ).rows[0]!,
      copied = (
        await c.query(
          'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [destination],
        )
      ).rows[0]!
    expect(saved.published_version_id).toBe(initialSourceLive)
    const slide = saved.content[0].values
    expect(slide.slides.items).toEqual(['i1', 'i2', 'i3'])
    expect(slide.slides__i3__intro).toBe(values.slides__i3__intro)
    expect(String(slide.slides__i3__intro)).toHaveLength(230)
    expect(slide.slides__i1__primary).toMatchObject({
      label: '[Visit]',
      url: '/visit#visit-details',
      newTab: true,
      nofollow: true,
    })
    expect(slide.slides__i1__phone_photo.media_id).toBe(photos[1])
    expect(slide.slides__i1__starts_at).toBe('2099-11-27T11:00:00.000Z')
    expect(slide.slides__i1__ends_at).toBe('2100-01-01T05:00:00.000Z')
    const last = copied.content.at(-1).values
    expect(last.slides.items).toEqual(['i1'])
    expect(last.slides__i1__enabled).toBe('off')
    expect(last.slides__i1__title).toBe('[Edited hero]')
    expect(copied.content[2].values.__cms_anchor).toBe('visit-details')
    await publish(page)
    const visitor = await browser.newContext({ reducedMotion: 'reduce' })
    try {
      const p = await visitor.newPage()
      await p.clock.install({ time: new Date('2099-11-27T10:59:59Z') })
      await p.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
      const first = p.locator('[data-cms-hero-key="i1"]')
      await expect(first).toHaveAttribute('hidden', '')
      await p.clock.fastForward(1100)
      await expect(first).not.toHaveAttribute('hidden', '')
      await expect(p.locator('.cms-hero-slide[inert]')).toHaveCount(2)
      await p
        .locator('.cms-hero-slide:not([inert])')
        .getByRole('link', { name: 'Slide 1: [Edited hero]', exact: true })
        .click()
      await expect(first).not.toHaveAttribute('inert', '')
      for (const width of [1440, 1024, 390]) {
        await p.setViewportSize({ width, height: 900 })
        expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (width === 390) await expect(first.locator('.cms-hero-phone-picture')).toHaveCSS('display', 'block')
        await p.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
      }
      const popupPromise = visitor.waitForEvent('page')
      await first.getByRole('link', { name: '[Visit]', exact: true }).click()
      const popup = await popupPromise
      await popup.waitForLoadState()
      await expect(popup).toHaveURL(new RegExp('/visit#visit-details$'))
      await expect(popup.getByRole('heading', { name: '[Visit details]', exact: true })).toBeInViewport()
      expect(await popup.evaluate(() => scrollY)).toBeGreaterThan(500)
      await popup.close()
      await p.clock.setSystemTime(new Date('2100-01-01T05:00:00Z'))
      await p.clock.fastForward(1100)
      await expect(first).toHaveAttribute('hidden', '')
    } finally {
      await visitor.close()
    }
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } })
    try {
      const p = await nojs.newPage()
      await p.goto('http://' + f.host + `:${E2E_PORTS.site}/`)
      await p.getByRole('link', { name: '[Go 2]', exact: true }).click()
      await expect(p).toHaveURL(new RegExp('/visit#visit-details$'))
      await expect(p.getByRole('heading', { name: '[Visit details]', exact: true })).toBeInViewport()
      expect(await p.evaluate(() => scrollY)).toBeGreaterThan(500)
      await p.screenshot({ path: resolve(folder, 'scriptless-section-jump-390.png'), fullPage: true })
    } finally {
      await nojs.close()
    }
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const removed = (
      await c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [destination],
      )
    ).rows[0]!
    delete removed.content[2].values.__cms_anchor
    const next = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        destination,
        removed.revision,
        JSON.stringify(removed.content),
        JSON.stringify(removed.meta),
      ])
    ).rows[0]!
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [destination, next.revision])
    await c.query('COMMIT')
    await page.goto('/pages/' + source)
    await expect(
      page.getByText(
        'A link points to a section that is no longer on /visit. Choose another section or the top of the page.',
        { exact: true },
      ),
    ).toBeVisible()
    await capture('missing-section-attention')
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
