import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { processMediaBytes } from '../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/round3/footer-screen', engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect
      .poll(() =>
        page.locator('#main').evaluate(main =>
          [...main.querySelectorAll('button,input,select,textarea,a[href],iframe')]
            .filter(element => element.getClientRects().length && !element.closest('dialog:not([open])'))
            .filter(element => {
              const box = element.getBoundingClientRect()
              return box.left < 0 || box.right > innerWidth + 1
            })
            .map(
              element =>
                element.getAttribute('aria-label') ||
                element.getAttribute('title') ||
                element.textContent?.slice(0, 60),
            ),
        ),
      )
      .toEqual([])
    await expect(page.getByText('Updating footer preview…', { exact: true })).toHaveCount(0)
    if (await page.locator('iframe[title="Footer preview"]').count())
      await expect
        .poll(() =>
          page
            .frameLocator('iframe[title="Footer preview"]')
            .locator('footer')
            .evaluate(node => node.getBoundingClientRect().bottom <= innerHeight + 1),
        )
        .toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('Footer keeps the header logo, cancels live link additions and saves only its own draft', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    store = createFilesystemMediaStore(defaultMediaRoot()),
    objects: string[] = []
  try {
    const mediaId = randomUUID(),
      bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png')),
      processed = await processMediaBytes(
        {
          intentId: randomUUID(),
          siteId: f.siteId,
          uploadObjectKey: 'footer-fixture/input.png',
          finalKeyPrefix: 'footer-fixture/' + mediaId + '/',
          declaredMime: 'image/png',
          declaredBytes: bytes.length,
        },
        bytes,
      ),
      original = processed.original
    for (const file of [original, ...processed.variants]) {
      await store.put(file.objectKey, file.data, file.mimeType)
      objects.push(file.objectKey)
    }
    await f.client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'[Logo fixture].png','[Sample landscape]',$5,$6,$7,$8,'ready')",
      [
        mediaId,
        f.siteId,
        original.objectKey,
        original.sha256,
        original.width,
        original.height,
        original.bytes,
        original.mimeType,
      ],
    )
    for (const file of processed.variants)
      await f.client.query(
        'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [mediaId, file.kind, file.objectKey, file.sha256, file.width, file.height, file.bytes, file.mimeType],
      )
    const admin = (await f.pool.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [admin, f.siteId, 'site_admin'])
    await f.client.query('COMMIT')

    await signIn(page, 'contributor@example.test')
    await page.goto('/sites/' + f.siteId + '/footer')
    await expect(page.getByRole('heading', { level: 1, name: 'Footer', exact: true })).toBeVisible()
    const frame = page.frameLocator('iframe[title="Footer preview"]')
    await expect(frame.locator('footer .national-brand img')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use a different logo', exact: true })).toBeVisible()
    await capture(page, 'footer', info.project.name)
    const links = page.getByRole('region', { name: 'Links', exact: true }),
      count = await links.getByRole('listitem').count()
    const nextLink = links.getByRole('listitem').nth(1)
    const nextLinkBounds = await nextLink.boundingBox()
    expect(nextLinkBounds).not.toBeNull()
    await links
      .getByRole('listitem')
      .first()
      .dragTo(nextLink, {
        targetPosition: { x: 12, y: Math.round(nextLinkBounds!.height * 0.78) },
      })
    await expect(links.getByRole('listitem').first()).toContainText('Give')
    await links.getByRole('button', { name: 'Actions for Home', exact: true }).click()
    await links.getByRole('button', { name: 'Move up', exact: true }).click()
    await links.getByRole('button', { name: 'Add', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Add footer link', exact: true })
    await dialog.getByLabel(/^Link label/).fill('[Cancelled footer link]')
    await dialog.getByLabel(/^Web address/).fill('/cancelled-footer')
    await expect(frame.getByRole('link', { name: '[Cancelled footer link]', exact: true })).toBeVisible()
    await capture(page, 'add-link', info.project.name)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(links.getByRole('listitem')).toHaveCount(count)
    await expect(frame.getByRole('link', { name: '[Cancelled footer link]', exact: true })).toHaveCount(0)
    await links.getByRole('button', { name: 'Add', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Add footer link', exact: true })
    await dialog.getByRole('button', { name: 'A page on this site', exact: true }).click()
    await dialog.getByLabel(/^Page/).selectOption({ index: 1 })
    await dialog.getByLabel(/^Link label/).fill('[Reviewed footer page]')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await links.getByRole('button', { name: 'Actions for [Reviewed footer page]', exact: true }).click()
    await links.getByRole('button', { name: 'Move up', exact: true }).click()
    await expect(links.getByRole('listitem').nth(count - 1)).toContainText('[Reviewed footer page]')
    await page.getByRole('button', { name: 'Use a different logo', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await expect(picker.getByRole('button', { name: 'Upload', exact: true })).toBeVisible()
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Use a different logo', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Use a different logo', exact: true }).click()
    await picker.getByRole('listbox', { name: 'Available images', exact: true }).getByRole('option').first().click()
    await picker.getByLabel('Image description', { exact: true }).fill('[Footer logo description]')
    await picker.getByRole('button', { name: 'Use this logo', exact: true }).click()
    await expect(frame.locator('footer img[alt="[Footer logo description]"]')).toBeVisible()
    await capture(page, 'custom-logo', info.project.name)
    await page.getByRole('button', { name: "Use the header's logo", exact: true }).click()
    await expect(page.getByRole('button', { name: 'Use a different logo', exact: true })).toBeVisible()
    await page.getByText('Words beside the logo', { exact: true }).click()
    await page.getByLabel('Site name', { exact: true }).fill('[Reviewed footer name]')
    await expect(frame.getByRole('link', { name: /Reviewed footer name/ })).toBeVisible()
    await page.getByLabel('Mission statement', { exact: true }).fill('[Reviewed mission & purpose]')
    await expect(frame.getByText('[Reviewed mission & purpose]', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'HTML source', exact: true })).toHaveCount(0)
    const before = (
        await f.pool.query(
          'SELECT kind,draft_version_id,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY kind',
          [f.siteId],
        )
      ).rows,
      navBefore = (
        await f.pool.query('SELECT revision,draft_version_id,published_version_id FROM navigations WHERE site_id=$1', [
          f.siteId,
        ])
      ).rows
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Footer draft saved.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    const after = (
      await f.pool.query(
        'SELECT g.kind,g.draft_version_id,g.published_version_id,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
        [f.siteId],
      )
    ).rows
    for (const row of after)
      expect(row.published_version_id).toBe(before.find(item => item.kind === row.kind).published_version_id)
    expect(after.find(row => row.kind === 'header').draft_version_id).toBe(
      before.find(row => row.kind === 'header').draft_version_id,
    )
    expect(
      (
        await f.pool.query('SELECT revision,draft_version_id,published_version_id FROM navigations WHERE site_id=$1', [
          f.siteId,
        ])
      ).rows,
    ).toEqual(navBefore)
    const saved = after.find(row => row.kind === 'footer').content.component.values
    expect(saved.name).toBe('[Reviewed footer name]')
    expect(saved.logo).toBeUndefined()
    expect(saved.mission).toBe('<p>[Reviewed mission &amp; purpose]</p>')
    expect(saved.links).not.toContain('Cancelled')
    expect(saved.links).toContain('[Reviewed footer page]')
    await page.reload()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Preview footer', exact: true })
    await expect(
      page.frameLocator('iframe[title="Footer on the full page"]').locator('footer .national-brand img'),
    ).toBeVisible()
    await capture(page, 'preview', info.project.name)
    await preview.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('link', { name: 'Publish…', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/sites/' + f.siteId + '/publishing'))
    await expect(page).toHaveURL(/area=footer$/)
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1)
    for (const row of await page.getByRole('row').all()) {
      if (await row.getByText('Page', { exact: true }).count())
        await expect(row.getByRole('checkbox')).not.toBeChecked()
    }
    await capture(page, 'publish-scope', info.project.name)
  } finally {
    f.client.release()
    await f.pool.end()
    for (const key of objects) await store.remove(key)
  }
})
test('Editors have no Footer controls or direct route access', async ({ page }, info) => {
  const f = await sawsoFixture(true, true)
  try {
    const user = (await f.pool.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query('SELECT app.set_site_membership($1,$2,$3)', [user, f.siteId, 'editor'])
    await f.client.query('COMMIT')
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.siteId)
    await expect(page.getByRole('link', { name: 'Footer', exact: true })).toHaveCount(0)
    const response = await page.goto('/sites/' + f.siteId + '/footer')
    expect(response?.status()).toBe(404)
    await capture(page, 'editor-no-access', info.project.name)
  } finally {
    f.client.release()
    await f.pool.end()
  }
})
