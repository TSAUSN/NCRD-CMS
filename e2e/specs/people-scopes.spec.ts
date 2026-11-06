import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn, canvas } from './helpers.ts'
test.use({ actionTimeout: 15_000 })
test('People describes chapter and division access, preserves it on account saves and explains paused access', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const f = await echelonFixture(true),
    folder = resolve('../.r8-progress/echelon/people'),
    errors: string[] = []
  const context = await browser.newContext(),
    volunteerPage = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  volunteerPage.on('pageerror', error => errors.push(error.message))
  const capture = async (name: string, active = page) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      if (name === 'empty')
        await active
          .getByRole('searchbox', { name: 'Find a person', exact: true })
          .evaluate(node => node.scrollIntoView({ block: 'center' }))
      else if (
        active === page &&
        (await active.getByRole('region', { name: 'Edit account access', exact: true }).count())
      )
        await active
          .getByRole('heading', { name: 'Edit account access', exact: true })
          .evaluate(node => node.scrollIntoView({ block: 'start' }))
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await active.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await mkdir(folder, { recursive: true })
    const token = randomBytes(32).toString('base64url'),
      email = 'people-' + token.slice(0, 8).toLowerCase() + '@example.test',
      staffEmail = 'division-' + token.slice(0, 8).toLowerCase() + '@example.test'
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const volunteer = (
      await f.client.query('SELECT app.provision_user($1,$2) AS id', [email, 'Chapter volunteer (sample)'])
    ).rows[0]!.id
    const staff = (
      await f.client.query('SELECT app.provision_user($1,$2) AS id', [staffEmail, 'Division editor (sample)'])
    ).rows[0]!.id
    const division = (
      await f.client.query("SELECT app.create_chapter_division($1,'Example division (sample)') AS id", [f.site])
    ).rows[0]!.id
    const chapter = (await f.client.query("SELECT id FROM chapters WHERE site_id=$1 AND slug='peoria'", [f.site]))
      .rows[0]!.id
    await f.client.query('SELECT app.assign_chapter_editor($1,$2,true)', [chapter, volunteer])
    await f.client.query('SELECT app.set_chapter_division_member($1,$2,true)', [division, staff])
    await f.client.query('SELECT app.assign_chapter_division($1,$2)', [chapter, division])
    await f.client.query('SELECT app.queue_local_chapter_sign_in($1,$2,$3)', [
      email,
      token,
      `http://127.0.0.1:${E2E_PORTS.admin}`,
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/people')
    await page.getByRole('combobox', { name: 'Showing people for', exact: true }).selectOption(f.site)
    await capture('site-people')
    const people = page.getByRole('table', { name: 'People and access', exact: true }),
      person = people.getByRole('row').filter({ hasText: email }),
      staffRow = people.getByRole('row').filter({ hasText: staffEmail })
    await expect(person).toContainText('1 chapter page')
    await expect(person).toContainText('Content creator')
    await expect(person).not.toContainText('0 assigned sites')
    await expect(staffRow).toContainText('1 division')
    await expect(staffRow).toContainText('Site editor · division')
    await person.getByRole('button', { name: 'Edit access for ' + email, exact: true }).click()
    const editor = page.getByRole('region', { name: 'Edit account access', exact: true })
    await editor.scrollIntoViewIfNeeded()
    await expect(editor).toContainText('Peoria Chapter')
    await expect(editor.getByRole('button', { name: 'Resend invitation' })).toHaveCount(0)
    await expect(editor.locator('#person-site-' + f.site)).toHaveValue('')
    await capture('chapter-access')
    await editor
      .getByLabel('Name', { exact: true })
      .fill('Updated chapter volunteer (sample) ' + 'extended name '.repeat(11))
    await editor.getByRole('button', { name: 'Save account access', exact: true }).click()
    await expect(person).toContainText('Updated chapter volunteer (sample)')
    await expect(person).toContainText('1 chapter page')
    await capture('long-name')
    expect(
      (await f.pool.query('SELECT count(*)::int AS n FROM site_memberships WHERE user_id=$1', [volunteer])).rows[0]!.n,
    ).toBe(0)
    await volunteerPage.goto(`http://127.0.0.1:${E2E_PORTS.admin}/auth/local-chapter?code=` + token)
    await expect(canvas(volunteerPage).locator('h1')).toHaveText('Peoria Chapter')
    await volunteerPage.goto(`http://127.0.0.1:${E2E_PORTS.admin}/people`)
    await expect(volunteerPage.getByRole('heading', { name: 'Your access', exact: true })).toBeVisible()
    await expect(volunteerPage.getByRole('link', { name: 'Peoria Chapter', exact: true })).toBeVisible()
    await expect(volunteerPage.getByText('changes need approval', { exact: false })).toBeVisible()
    await expect(volunteerPage.getByRole('link', { name: 'North Texas Chapter', exact: true })).toHaveCount(0)
    await expect(volunteerPage.getByText('Content creator · assigned pages', { exact: true })).toBeVisible()
    await capture('volunteer-access', volunteerPage)
    await volunteerPage.context().clearCookies()
    await signIn(volunteerPage, staffEmail)
    await volunteerPage.goto('/people')
    await expect(
      volunteerPage.getByText(
        'Site editor · Example division (sample). You can edit and approve this division’s chapter pages.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(volunteerPage.getByText('Site editor · division', { exact: true })).toBeVisible()
    await capture('division-access', volunteerPage)
    await staffRow.getByRole('button', { name: 'Edit access for ' + staffEmail, exact: true }).click()
    await editor.scrollIntoViewIfNeeded()
    await expect(editor.getByRole('link', { name: 'Manage division team', exact: true })).toBeVisible()
    await capture('division-editor')
    await page.getByRole('searchbox', { name: 'Find a person', exact: true }).fill('nobody-matches-this')
    await expect(page.getByRole('heading', { name: 'No people match', exact: true })).toBeVisible()
    await capture('empty')
    await page.getByRole('searchbox', { name: 'Find a person', exact: true }).fill('')
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const row = (
      await f.client.query(
        'SELECT c.revision,c.slug,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1',
        [chapter],
      )
    ).rows[0]!
    await f.client.query('SELECT app.save_chapter_setup($1,$2,$3,$4,$5)', [
      f.site,
      chapter,
      row.revision,
      row.slug,
      JSON.stringify({ ...row.config, updateMode: 'division' }),
    ])
    await f.client.query('COMMIT')
    await page.reload()
    await page.getByRole('searchbox', { name: 'Find a person', exact: true }).fill(email)
    await expect(person).toContainText('Chapter access paused')
    await person.getByRole('button', { name: 'Edit access for ' + email, exact: true }).click()
    await editor.scrollIntoViewIfNeeded()
    await expect(editor).toContainText('Access paused')
    await capture('paused')
    const revision = (await f.pool.query('SELECT revision FROM app_users WHERE id=$1', [volunteer])).rows[0]!.revision
    await f.client.query('BEGIN')
    await f.client.query('SET LOCAL ROLE cms_authenticated_user')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await f.client.query('SELECT app.update_person($1,$2,$3,$4,$5)', [
      volunteer,
      revision,
      'Newer saved name (sample)',
      'active',
      '[]',
    ])
    await f.client.query('COMMIT')
    await editor.getByLabel('Name', { exact: true }).fill('An older form (sample)')
    await editor.getByRole('button', { name: 'Save account access', exact: true }).click()
    await expect(editor.getByRole('alert')).toBeVisible()
    await capture('stale-error')
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    f.client.release()
    await f.pool.end()
  }
})
