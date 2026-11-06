import { expect, test, type Page } from '@playwright/test'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { signIn } from './helpers.ts'

// COLL-05: a collection from an earlier, three-field program starter is
// offered the current starter's fields, adds them as optional fields for
// review, and publishes them without changing its own keys.
const SLUG = `older-agenda-${Date.now()}`

async function database<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const { database: name, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${name}` })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function openCollections(page: Page) {
  await signIn(page, 'root@example.test')
  await page.getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.getByRole('link', { name: 'Lists', exact: true }).click()
}

test.afterAll(async () => {
  await database(async client => {
    await client.query(
      'DELETE FROM collection_entries WHERE collection_id IN (SELECT id FROM collections WHERE slug=$1)',
      [SLUG],
    )
    await client.query('DELETE FROM collections WHERE slug=$1', [SLUG])
  })
})

test('a collection from an earlier starter is offered the current fields, adds them optional and keeps its own', async ({
  page,
}) => {
  await openCollections(page)
  await page.getByRole('button', { name: 'New list', exact: true }).first().click()
  const create = page.getByRole('dialog', { name: 'Create a list' })
  await create.getByRole('button', { name: /Agenda/ }).click()
  await create.getByLabel('List name').fill('Older agenda')
  await create.getByText('Advanced · addresses and keys', { exact: true }).click()
  await create.getByLabel('List address').fill(SLUG)
  await create.getByLabel('Reader key').fill(SLUG.replaceAll('-', '_'))
  await create.getByRole('button', { name: 'Create list' }).click()
  await expect(page.getByRole('heading', { name: 'Older agenda', level: 2 })).toBeVisible()

  // Make it the earlier three-field starter: title, date and time.
  await page.getByRole('button', { name: 'More list actions', exact: true }).click()
  await page.getByRole('button', { name: 'List settings', exact: true }).click()
  const schema = page.getByRole('dialog', { name: 'List settings' })
  for (const label of ['Location', 'Speaker names', 'Track or category', 'Session details', 'Session information']) {
    await schema.getByRole('button', { name: `Actions for field ${label}`, exact: true }).click()
    await schema.getByRole('button', { name: `Remove ${label}` }).click()
  }
  await expect(schema.locator('.schema-field-card')).toHaveCount(3)
  // Already the three-field shape: the designer offers the current starter's fields.
  const offer = schema.getByRole('status').filter({ hasText: 'began from an earlier Program starter' })
  await expect(offer).toContainText('Location, Speaker names, Track or category, Session details, Session information')
  await schema.getByRole('button', { name: 'Save fields' }).click()
  await expect(schema).toBeHidden()
  await page.getByRole('button', { name: 'More list actions', exact: true }).click()
  await page.getByRole('button', { name: 'Publish field changes', exact: true }).click()
  await expect(page.getByText('List fields published. Updated items can now be published.')).toBeVisible()

  await page.getByRole('button', { name: 'More list actions', exact: true }).click()
  await page.getByRole('button', { name: 'List settings', exact: true }).click()
  await expect(offer).toBeVisible()
  await offer.getByRole('button', { name: 'Add these fields' }).click()
  await expect(offer).toBeHidden()
  await expect(schema.locator('.schema-field-card')).toHaveCount(8)
  await schema.getByRole('button', { name: 'Save fields' }).click()
  await expect(schema).toBeHidden()
  await page.getByRole('button', { name: 'More list actions', exact: true }).click()
  await page.getByRole('button', { name: 'Publish field changes', exact: true }).click()
  await expect(page.getByText('List fields published. Updated items can now be published.')).toBeVisible()

  const fields = await database(
    async client =>
      (
        await client.query(
          `SELECT version.fields FROM collections collection
    JOIN collection_schema_versions version ON version.id=collection.published_schema_version_id WHERE collection.slug=$1`,
          [SLUG],
        )
      ).rows[0]!.fields,
  )
  expect(fields.map((field: { key: string; required: boolean }) => [field.key, field.required])).toEqual([
    ['title', true],
    ['date', true],
    ['time', true],
    ['location', false],
    ['speakers', false],
    ['category', false],
    ['summary', false],
    ['session_url', false],
  ])
})
