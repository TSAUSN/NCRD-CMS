import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn } from './helpers.ts'
test('division page is a private chapter draft with its own filter, safe publication, no local page and address-check reminders', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false, true),
    folder = resolve('../.r8-progress/round3/chapter-division/' + info.project.name),
    name = '[Division linked chapter]',
    address = 'https://division.example.test/echelon'
  const capture = async (label: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      await page.screenshot({ path: resolve(folder, label + '-' + width + '.png') })
    }
  }
  try {
    await mkdir(folder, { recursive: true })
    const count = Number((await f.pool.query('SELECT count(*) n FROM pages WHERE site_id=$1', [f.site])).rows[0]!.n)
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/chapters')
    await page.getByRole('button', { name: '+ Add a chapter', exact: true }).click()
    let form = page.getByRole('dialog', { name: 'Add a chapter', exact: true })
    await form.getByLabel(/^Chapter name/).fill(name)
    await form.getByRole('radio', { name: 'Their division’s page', exact: true }).check()
    await form.getByLabel(/^Page address/).fill('http://division.example.test/echelon')
    await form.getByLabel(/^Contact name/).fill('[Name]')
    await form.getByLabel(/^Contact role/).fill('[Division] web team')
    await form.getByLabel(/^Contact email/).fill('division-check@example.test')
    await form.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('full https address')
    await form.getByLabel(/^Page address/).fill(address)
    await form.getByRole('radiogroup').scrollIntoViewIfNeeded()
    await capture('destination')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    let leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await capture('leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(form.getByLabel(/^Page address/)).toHaveValue(address)
    await page.keyboard.press('Escape')
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Chapter link saved as a draft' })).toContainText(
      'Chapter link saved as a draft',
    )
    await page.getByRole('button', { name: 'Division’s page', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row).toBeVisible()
    await capture('filtered')
    const stored = (
      await f.pool.query(
        'SELECT c.id,c.revision,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=$1',
        [f.site],
      )
    ).rows[0]!
    expect(stored.config.destination).toBe('division')
    expect(stored.config.pageId).toBeNull()
    expect(Number((await f.pool.query('SELECT count(*) n FROM pages WHERE site_id=$1', [f.site])).rows[0]!.n)).toBe(
      count,
    )
    expect(
      (await f.pool.query('SELECT public_api.chapter_directory($1) entries', [f.hostname])).rows[0]!.entries,
    ).toEqual([])
    await row.getByRole('button', { name, exact: true }).click()
    await page.getByRole('dialog', { name, exact: true }).getByRole('button', { name: 'Set up', exact: true }).click()
    form = page.getByRole('dialog', { name: 'Set up ' + name, exact: true })
    await expect(form.getByRole('link', { name: 'Open chapter page', exact: true })).toHaveCount(0)
    await form.getByRole('radiogroup').scrollIntoViewIfNeeded()
    await capture('edit-destination')
    await form.getByLabel(/^Contact email/).scrollIntoViewIfNeeded()
    await capture('contact')
    await expect(form.getByText('There’s no chapter page to edit on this site.', { exact: false })).toBeVisible()
    await form.getByLabel(/^Page address/).fill('https://division.example.test/discard')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(form).toBeHidden()
    expect(
      (
        await f.pool.query('SELECT config FROM chapter_versions WHERE chapter_id=$1 ORDER BY revision DESC LIMIT 1', [
          stored.id,
        ])
      ).rows[0]!.config.externalUrl,
    ).toBe(address)
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await expect(
      f.client.query('SELECT app.create_chapter_page($1,$2)', [stored.id, stored.revision]),
    ).rejects.toMatchObject({ code: 'CMS04' })
    await f.client.query('ROLLBACK')
    const contributor = (await f.pool.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!
      .id
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [contributor])
    await expect(
      f.client.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
        f.site,
        stored.id,
        stored.revision,
        'division-linked',
        JSON.stringify(stored.config),
      ]),
    ).rejects.toMatchObject({ code: 'CMS02' })
    await f.client.query('ROLLBACK')
    await page.goto('/sites/' + f.site + '/publishing')
    await expect(page.getByText('Chapter directory destination changed', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(
      page.getByRole('alertdialog').getByText('Chapter directory destination changed', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('alertdialog')
      .getByText('Chapter directory destination changed', { exact: true })
      .scrollIntoViewIfNeeded()
    await capture('review')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const entries = (await f.pool.query('SELECT public_api.chapter_directory($1) entries', [f.hostname])).rows[0]!
      .entries
    expect(entries).toEqual([
      { slug: 'division-linked', name, path: null, externalUrl: address, destination: 'division' },
    ])
    expect(JSON.stringify(entries)).not.toContain('division-check@example.test')
    const context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const view = await context.newPage()
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 950 })
        await view.goto('http://' + f.hostname + `:${E2E_PORTS.site}/chapters`)
        await expect(view.getByRole('link', { name: 'Visit their division’s page ↗', exact: true })).toHaveAttribute(
          'href',
          address,
        )
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    for (const cycle of ['2027-01-01', '2027-07-01'])
      expect(
        Number(
          (
            await f.client.query('SELECT app.record_chapter_check($1,$2,$3) n', [
              f.site,
              cycle,
              `http://127.0.0.1:${E2E_PORTS.admin}`,
            ])
          ).rows[0]!.n,
        ),
      ).toBe(1)
    await f.client.query('COMMIT')
    const messages = (
      await f.pool.query(
        "SELECT body FROM local_chapter_outbox WHERE site_id=$1 AND kind='check' ORDER BY created_at",
        [f.site],
      )
    ).rows
    expect(messages).toHaveLength(2)
    for (const message of messages) {
      expect(message.body).toContain('Please check that your division’s page address still works')
      expect(message.body).toContain(address)
      expect(message.body).not.toContain('/pages/')
    }
    await page.goto('/sites/' + f.site + '/outbox')
    await capture('local-reminders')
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
  }
})
