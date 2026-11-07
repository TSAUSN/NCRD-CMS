import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
import { saveStoryDetails, type StoryEditInput } from '../../../apps/admin/src/lib/stories-edit.ts'
test('Story conflict recovery preserves words, combines independent changes and requires an overlapping-field choice', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-draft-recovery/' + info.project.name)
  await mkdir(folder, { recursive: true })
  try {
    const record = (
      await f.pool.query(
        "SELECT e.id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND v.values->>'title'=$2",
        [f.collectionId, 'Primary Health Care to Support the Growing Chikankata Community'],
      )
    ).rows[0]!
    const remote = async (patch: Partial<StoryEditInput>) => {
      await f.client.query('BEGIN')
      await f.client.query('SET LOCAL ROLE cms_authenticated_user')
      await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
      try {
        const row = (
            await f.client.query(
              'SELECT c.entry_revision,v.values FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.id=$1 AND e.id=$2',
              [f.collectionId, record.id],
            )
          ).rows[0]!,
          v = row.values
        await saveStoryDetails(f.client, f.siteId, f.collectionId, record.id, String(row.entry_revision), {
          title: v.title,
          summary: v.summary,
          tags: String(v.tags ?? '')
            .split(',')
            .filter(Boolean),
          region: v.region ?? '',
          regions: String(v.regions ?? v.region ?? '')
            .split(',')
            .filter(Boolean),
          published_date: v.published_date ?? '',
          countries: v.countries ?? '',
          body: v.body ?? '',
          body_is_sample: v.body_is_sample === true,
          ...patch,
        })
        await f.client.query('COMMIT')
      } catch (error) {
        await f.client.query('ROLLBACK')
        throw error
      }
    }
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/stories/' + record.id)
    await page.getByLabel('Summary', { exact: true }).fill('[My unsaved story summary]')
    await remote({ countries: '[Saved country]' })
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Review saved story changes', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('different fields')
    await capture('independent-changes')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('[My unsaved story summary]')
    await expect(page.getByLabel('Summary', { exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Review saved changes', exact: true }).click()
    await dialog.getByRole('button', { name: 'Keep selected changes', exact: true }).click()
    await expect(page.getByLabel('Countries', { exact: true })).toHaveValue('[Saved country]')
    await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('[My unsaved story summary]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Story draft saved')
    // Wait for that action's refreshed tree before making a second independent edit.
    await page.reload()
    await page.getByLabel('Title', { exact: true }).fill('[My title]')
    await remote({ title: '[Saved title]', countries: '[New saved country]' })
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Review saved story changes', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Keep selected changes', exact: true })).toBeDisabled()
    await dialog.getByText('My changes', { exact: true }).click()
    await dialog.getByText('Saved changes', { exact: true }).click()
    await expect(dialog).toContainText('[My title]')
    await expect(dialog).toContainText('[Saved title]')
    await capture('overlapping-title')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('[My title]')
    await page.getByRole('button', { name: 'Review saved changes', exact: true }).click()
    await dialog.getByRole('radio', { name: 'Use saved title', exact: true }).check()
    await dialog.getByRole('button', { name: 'Keep selected changes', exact: true }).click()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('[Saved title]')
    await expect(page.getByLabel('Countries', { exact: true })).toHaveValue('[New saved country]')
    await capture('selected-changes')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Story draft saved')
    const saved = (
      await f.pool.query(
        'SELECT v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
        [record.id],
      )
    ).rows[0]!
    expect(saved.values).toMatchObject({
      title: '[Saved title]',
      summary: '[My unsaved story summary]',
      countries: '[New saved country]',
    })
    expect(saved.published_version_id).toBeNull()
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
