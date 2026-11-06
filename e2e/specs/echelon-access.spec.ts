import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn, canvas, saveDraft } from './helpers.ts'
import { rawRequest } from './http.ts'
import { saveChapterInTransaction } from '../../apps/admin/src/lib/chapters.ts'
import { echelonChapterSetups } from '@cms/seeds/echelon-chapters'
test.use({ actionTimeout: 15_000 })
test('a chapter volunteer sees only their page, preserves shared parts and sends changes to their division', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000)
  const f = await echelonFixture(false, false, true),
    folder = resolve('../.r8-progress/echelon/access'),
    suffix = randomUUID().slice(0, 8),
    email = 'chapter-' + suffix + '@example.test',
    staffEmail = 'division-' + suffix + '@example.test'
  let maryland = '',
    chapter = '',
    foreign = ''
  const capture = async (name: string, active = page) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      if (new URL(active.url()).pathname.startsWith('/pages/')) {
        await expect(canvas(active).locator('h1')).toHaveText('Maryland Chapter')
        await expect(active.locator('.canvas-loading')).toHaveCount(0)
        for (const panel of await active.getByRole('tabpanel').all())
          expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      }
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await active.setViewportSize({ width: 1440, height: 900 })
  }
  const reviewerContext = await browser.newContext({ timezoneId: 'America/Los_Angeles' }),
    reviewer = await reviewerContext.newPage(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  reviewer.on('pageerror', error => errors.push(error.message))
  try {
    await mkdir(folder, { recursive: true })
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const staff = (
      await f.client.query('SELECT app.provision_user($1,$2) AS id', [staffEmail, 'Division editor (sample)'])
    ).rows[0]!.id
    const division = (
      await f.client.query('SELECT app.create_chapter_division($1,$2) AS id', [f.site, 'Example division (sample)'])
    ).rows[0]!.id
    await f.client.query('SELECT app.set_chapter_division_member($1,$2,true)', [division, staff])
    const other = await saveChapterInTransaction(
      f.client,
      f.site,
      null,
      '0',
      'north-texas',
      echelonChapterSetups().find(row => row.slug === 'north-texas')!.config,
      16,
    )
    foreign = other.config.pageId!
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto(
      '/sites/' +
        f.site +
        '/publishing?pages=' +
        f.pages
          .filter(row => ['', 'chapters'].includes(row.slug))
          .map(row => row.id)
          .join(',') +
        '&siteLook=1&lists=1',
    )
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    await signIn(reviewer, staffEmail)
    await reviewer.getByRole('link', { name: /Set up chapters/ }).click()
    await expect(reviewer.getByRole('table', { name: 'Chapters', exact: true }).locator('tbody tr')).toHaveCount(0)
    await reviewer.getByRole('button', { name: '+ Add a chapter', exact: true }).click()
    const setup = reviewer.getByRole('dialog', { name: 'Add a chapter', exact: true })
    await setup.getByRole('textbox', { name: /^Chapter name/ }).fill('Maryland Chapter')
    await capture('add-maryland', reviewer)
    await setup.getByRole('button', { name: 'Continue', exact: true }).click()
    await capture('maryland-sections', reviewer)
    await setup.getByRole('button', { name: 'Continue', exact: true }).click()
    await setup.getByLabel('How the page gets updated', { exact: true }).selectOption('chapter-editors')
    await capture('maryland-people', reviewer)
    await setup.getByRole('button', { name: 'Save chapter', exact: true }).click()
    await expect(reviewer.getByRole('status').filter({ hasText: 'Chapter saved as a draft' })).toBeVisible()
    const created = (
      await f.pool.query(
        "SELECT c.id,v.config->>'pageId' AS page FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=$1 AND c.slug='maryland'",
        [f.site],
      )
    ).rows[0]!
    chapter = created.id
    maryland = created.page
    const ownedRow = reviewer.locator('tr[data-chapter-id="' + chapter + '"]')
    await expect(reviewer.getByRole('table', { name: 'Chapters', exact: true }).locator('tbody tr')).toHaveCount(1)
    await capture('division-chapters', reviewer)
    const before = await ownedRow.getAttribute('data-revision')
    await ownedRow.getByRole('button', { name: 'Maryland Chapter', exact: true }).click()
    await reviewer
      .getByRole('dialog', { name: 'Maryland Chapter', exact: true })
      .getByRole('button', { name: 'Set up', exact: true })
      .click()
    await reviewer.getByRole('button', { name: 'Continue', exact: true }).click()
    await reviewer.getByRole('button', { name: 'Continue', exact: true }).click()
    await reviewer.getByLabel('How the page gets updated', { exact: true }).selectOption('chapter-editors')
    await reviewer.getByRole('button', { name: 'Save chapter', exact: true }).click()
    await expect(reviewer.getByLabel('How the page gets updated', { exact: true })).toHaveCount(0)
    await expect(ownedRow).not.toHaveAttribute('data-revision', before!)
    // A site administrator controls section visibility; the volunteer edits content.
    await page.goto('/pages/' + maryland)
    await page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: 'This year’s events', exact: true })
      .click()
    await page.getByRole('tab', { name: 'Visibility', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide until ready', exact: true }).check()
    await saveDraft(page)
    await reviewer.reload() // Refresh the chapter revision after the administrator's page change.
    await ownedRow.getByRole('button', { name: 'Maryland Chapter', exact: true }).click()
    await reviewer
      .getByRole('dialog', { name: 'Maryland Chapter', exact: true })
      .getByRole('button', { name: 'Invite a volunteer', exact: true })
      .click()
    const invitation = reviewer.getByRole('dialog', { name: 'Invite an editor for Maryland Chapter' })
    await invitation.getByRole('button', { name: 'Invite chapter editor', exact: true }).click()
    await expect(invitation.getByRole('alert')).toContainText('name and email')
    await capture('invite-error', reviewer)
    await invitation.getByRole('textbox', { name: /^Volunteer name/ }).fill('Chapter editor (sample)')
    await invitation.getByRole('textbox', { name: /^Volunteer email/ }).fill(email)
    await capture('invite', reviewer)
    await invitation.getByRole('button', { name: 'Invite chapter editor', exact: true }).click()
    // A "Loading chapter editors…" status can be on screen at the same moment.
    await expect(reviewer.getByRole('status').filter({ hasText: 'no email was sent' })).toBeVisible()
    await expect(reviewer.getByRole('link', { name: 'Local outbox', exact: true })).toHaveCount(0)
    await expect(reviewer.getByText('Test tools (this computer only)', { exact: true })).toHaveCount(0)
    await page.goto('/sites/' + f.site + '/chapters')
    await page.getByText('Test tools (this computer only)', { exact: true }).click()
    await page.getByRole('link', { name: 'Local outbox', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Local outbox', level: 1 })).toBeVisible()
    await expect(page.getByText(email, { exact: false })).toBeVisible()
    await expect(page.locator('time[datetime]').first()).toContainText('Eastern time')
    await capture('local-outbox')
    const link = (
      await f.pool.query(
        'SELECT link FROM local_chapter_outbox WHERE chapter_id=$1 AND recipient=$2 ORDER BY created_at DESC,id LIMIT 1',
        [chapter, email],
      )
    ).rows[0]!.link as string
    await page.context().clearCookies()
    await page.goto(link)
    await expect(page).toHaveURL(new RegExp('/pages/' + maryland + '$'))
    await expect(canvas(page).locator('h1')).toHaveText('Maryland Chapter')
    const expired = await page.request.get(link, { maxRedirects: 0 })
    expect(expired.status()).toBe(303)
    expect(expired.headers()['location']).toContain('expired-link')
    expect(expired.headers()['cache-control']).toContain('no-store')
    expect(expired.headers()['referrer-policy']).toBe('no-referrer')
    await page.context().clearCookies()
    await page.goto('/sign-in')
    await page.getByLabel('Email address').fill(email)
    await page.getByRole('button', { name: 'Continue to local CMS', exact: true }).click()
    await expect(page).toHaveURL(/sign-in\?sent=1/)
    await expect(page.getByRole('status')).toContainText('No email was sent')
    await capture('request-sign-in')
    const requested = (
      await f.pool.query(
        'SELECT link FROM local_chapter_outbox WHERE chapter_id=$1 AND recipient=$2 ORDER BY created_at DESC,id LIMIT 1',
        [chapter, email],
      )
    ).rows[0]!.link as string
    expect(requested).not.toBe(link)
    await page.goto(requested)
    await expect(page).toHaveURL(new RegExp('/pages/' + maryland + '$'))
    await page.goto('/')
    await expect(page.getByRole('link', { name: /Edit Maryland Chapter/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Update lists', exact: true })).toHaveCount(0)
    await capture('volunteer-home')
    await page.getByRole('link', { name: /Edit Maryland Chapter/ }).click()
    await expect(canvas(page).locator('h1')).toHaveText('Maryland Chapter')
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Submit for review', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Site look', exact: true })).toHaveCount(0)
    await capture('volunteer-editor')
    await page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: 'What is Echelon', exact: true })
      .click()
    await expect(page.getByRole('status').filter({ hasText: 'Site editors only' })).toBeVisible()
    await capture('shared-locked')
    await expect(page.getByRole('button', { name: 'Hide What is Echelon', exact: true })).toHaveCount(0)
    await page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: 'This year’s events', exact: true })
      .click()
    await expect(page.getByRole('tab', { name: 'Visibility', exact: true })).toHaveCount(0)
    await page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: 'Board', exact: true })
      .click()
    await expect(page.getByRole('tablist', { name: 'Section settings', exact: true })).toHaveCount(0)
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
    await inspector.getByRole('button', { name: 'Actions for Board member 1', exact: true }).click()
    await inspector.getByRole('button', { name: 'Move Board member 1 down', exact: true }).click()
    await inspector.getByRole('button', { name: 'Add a board member', exact: true }).click()
    await expect(inspector.getByLabel('Description', { exact: true })).toHaveText('')
    await inspector.getByLabel('Title', { exact: true }).fill('[New board member] (sample)')
    await inspector.getByLabel('Description', { exact: true }).fill('[Board role]')
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await saveDraft(page)
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Phone', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas(page).getByText('[New board member] (sample)', { exact: true })).toBeVisible()
    await capture('volunteer-phone-preview')
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Submit this page for review?' })
    await dialog.getByLabel('Note for the reviewer').fill('[Chapter update for review]')
    await dialog.getByRole('button', { name: 'Submit for review', exact: true }).click()
    await expect(page.getByText('Submitted for review. The live site has not changed.', { exact: true })).toBeVisible()
    await capture('submitted')
    const denied = await page.context().newPage()
    denied.on('pageerror', error => errors.push(error.message))
    try {
      expect((await denied.goto('/pages/' + foreign))?.status()).toBe(404)
      await expect(denied.getByRole('heading', { name: '404', exact: true })).toBeVisible()
      await expect(denied.getByText('North Texas Chapter', { exact: true })).toHaveCount(0)
    } finally {
      await denied.close()
    }
    await reviewer.goto('/inbox')
    await expect(reviewer.getByRole('main')).not.toContainText(/collections?/i)
    await expect(reviewer.getByRole('heading', { name: 'Maryland Chapter', level: 2 })).toBeVisible()
    await expect(reviewer.getByRole('button', { name: 'Approve and publish', exact: true })).toBeVisible()
    await expect(reviewer.locator('time[datetime]').first()).toHaveAttribute('title', /Eastern time/)
    for (const width of [1440, 1024]) {
      await reviewer.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await reviewer.screenshot({ path: resolve(folder, 'division-inbox-' + width + '.png') })
    }
    await reviewer.getByRole('button', { name: 'Approve and publish', exact: true }).click()
    await reviewer
      .getByRole('alertdialog', { name: 'Approve and publish this version?' })
      .getByRole('button', { name: 'Approve and publish', exact: true })
      .click()
    await reviewer
      .getByRole('dialog', { name: 'Publish with sample content?' })
      .getByRole('button', { name: 'Publish with sample content', exact: true })
      .click()
    await expect(reviewer.getByText(/Approved and published “Maryland Chapter”/)).toBeVisible()
    const directory = await rawRequest({ host: f.hostname, path: '/chapters' })
    expect(directory.body).toContain('/chapters/maryland')
    const publicPage = await rawRequest({ host: f.hostname, path: '/chapters/maryland' })
    expect(publicPage.status).toBe(200)
    expect(publicPage.body).not.toContain('This year’s events')
    expect(publicPage.body).toContain('What is Echelon')
    const guest = await browser.newContext({ javaScriptEnabled: false }),
      visitor = await guest.newPage()
    try {
      for (const width of [1440, 1024, 390]) {
        await visitor.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
        await visitor.goto('http://' + f.hostname + `:${E2E_PORTS.site}/chapters/maryland`)
        await expect(visitor.locator('.core-chapter-board article')).toHaveCount(5)
        await expect(visitor.getByText('[New board member] (sample)', { exact: true })).toBeVisible()
        await expect(visitor.getByRole('heading', { name: 'This year’s events', exact: true })).toHaveCount(0)
        expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await visitor.screenshot({ path: resolve(folder, 'published-maryland-' + width + '.png'), fullPage: true })
      }
    } finally {
      await guest.close()
    }
    expect(errors).toEqual([])
  } finally {
    await reviewerContext.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
  }
})
