import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
import { evaluateVersionReadiness } from '@cms/platform'
import {
  executeSiteRelease,
  listReleaseCandidates,
  planSiteRelease,
  previewSiteReleasePage,
} from '../src/lib/releases.ts'

let db: TestDatabase
let site: Scenario
let boundPage: string
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))

const number = {
  id: randomUUID(),
  label: 'Chapters counted',
  value: '26',
  unit: '',
  source: 'Local verification record',
  asOf: 'FY2026',
  status: 'matches-report',
  sourcePageId: null,
  showSource: false,
}
const unused = { ...number, id: randomUUID(), label: 'Projects started', value: '15' }

async function saveSettings(numbers: unknown[], name = 'Site A') {
  return db.asUser(site.superAdmin, async client => {
    const revision = (await client.query('SELECT revision FROM site_settings WHERE site_id=$1', [site.siteA])).rows[0]!
      .revision
    return (
      await client.query('SELECT app.save_site_settings_draft($1,$2,$3) AS revision', [
        site.siteA,
        revision,
        JSON.stringify({ schemaVersion: 1, name, dataValues: numbers }),
      ])
    ).rows[0]!.revision
  })
}

beforeAll(async () => {
  db = await TestDatabase.create('data_value_release_scope')
  site = await seedScenario(db)
  const revision = await saveSettings([number])
  await db.asUser(site.superAdmin, async client => {
    await client.query('SELECT app.publish_site_settings($1,$2)', [site.siteA, revision])
    boundPage = (await client.query("SELECT app.create_page($1,'numbers','Chapter numbers') AS id", [site.siteA]))
      .rows[0]!.id
    for (const page of [site.pageA, boundPage]) {
      const content = JSON.parse(heroContent(site.heroDefId, 'Chapter numbers'))
      content[0].values.__cms_sample_fields = ['intro']
      if (page === boundPage)
        content[0].values.__cms_data_values = { heading: { parts: [{ text: 'Chapters: ' }, { valueId: number.id }] } }
      const draft = (
        await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          page,
          JSON.stringify(content),
          JSON.stringify({ description: 'A complete local release fixture.' }),
        ])
      ).rows[0]!
      const readiness = await evaluateVersionReadiness(client, draft.version_id, 'member')
      expect(readiness.blocking.map(finding => finding.rule)).toEqual(['sample_content'])
      await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
        page,
        draft.revision,
        readiness.policyVersion,
        'Confirmed: Publish with sample content.',
        JSON.stringify(readiness.findings),
      ])
    }
  })
})
afterAll(async () => db?.close())

async function prepareSettings() {
  const items = (await listReleaseCandidates(site.superAdmin, site.siteA)).filter(item => item.type === 'site_settings')
  expect(items).toHaveLength(1)
  return planSiteRelease(site.superAdmin, randomUUID(), site.siteA, items)
}

it('checks only pages using changed numbers; still requires sample consent on those pages and checks all for mixed settings', async () => {
  await saveSettings([number, unused])
  const addition = await prepareSettings()
  expect(addition.snapshot[0]?.label).toBe('Data values')
  expect(addition.preview_report).toEqual([])
  await executeSiteRelease(site.superAdmin, addition.id, '')

  await saveSettings([{ ...number, value: '27' }, unused])
  const update = await prepareSettings()
  expect(update.preview_report.map(check => check.pageId)).toEqual([boundPage])
  expect(await previewSiteReleasePage(site.superAdmin, update.id, boundPage)).toContain('Chapters: 27')
  await expect(executeSiteRelease(site.superAdmin, update.id, '')).rejects.toThrow('sample content')
  await executeSiteRelease(site.superAdmin, update.id, '', true)

  await saveSettings([{ ...number, value: '28' }, unused], 'New Site A name')
  const mixed = await prepareSettings()
  expect(mixed.snapshot[0]?.label).toBe('Site settings')
  expect(mixed.preview_report.map(check => check.pageId).sort()).toEqual([site.pageA, boundPage].sort())
  await expect(executeSiteRelease(site.superAdmin, mixed.id, '')).rejects.toThrow('sample content')
})
