import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
import { createDomainHandler } from '../../apps/worker/src/domains.ts'
import { withWorkerSession, type OutboxEvent } from '../../apps/worker/src/handlers.ts'

// Only the external provider is fake. Commands, leases, receipts, browser and
// public routing all execute against the isolated E2E database as real roles.
async function runConnection(hostname: string) {
  const pool = new Pool({
    connectionString: `postgres://cms_worker_app:devpassword@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
  const fixtures = new Pool({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
  try {
    const ids = (
      await pool.query<{ id: string }>('SELECT id FROM domains WHERE hostname_normalized=ANY($1::text[])', [
        [hostname, `www.${hostname}`],
      ])
    ).rows.map(r => r.id)
    const handler = createDomainHandler(pool, 'domain-browser', {
      attach: async host => ({ providerRef: `e2e:${host}` }),
      requiredRecords: async host => [
        { type: 'CNAME', name: host, value: 'customers.example.net' },
        { type: 'A', name: host, value: '192.0.2.1', action: 'REMOVE' },
        { type: 'CAA', name: host, value: '0 issue "pki.goog"', action: 'ADD' },
      ],
      check: async () => ({ state: 'live' }),
      detach: async () => {},
    })
    for (const domainId of ids) {
      const excluded = (
        await fixtures.query<{ id: string }>(
          "SELECT id FROM outbox WHERE event_type<>'domain.sync' OR payload->>'domain_id'<>$1",
          [domainId],
        )
      ).rows.map(row => row.id)
      const event = await withWorkerSession(
        pool,
        'domain-browser',
        async client =>
          (await client.query<OutboxEvent>('SELECT * FROM app.claim_outbox(60,$1::bigint[])', [excluded])).rows[0],
      )
      if (!event) continue
      await handler.handle(event)
      await withWorkerSession(pool, 'domain-browser', client =>
        client.query('SELECT app.settle_outbox($1,$2,true,NULL,false)', [event.id, event.lease_token]),
      )
    }
  } finally {
    await pool.end()
    await fixtures.end()
  }
}
test('connects a pair, shows exact DNS records, verifies public routing and revokes it before cleanup', async ({
  page,
  browser,
}) => {
  await signIn(page, 'root@example.test')
  const sitePath = await page
    .getByRole('main')
    .getByRole('link', { name: 'Demo site', exact: true })
    .getAttribute('href')
  await page.goto(sitePath + '/domains')
  await expect(page.getByRole('region', { name: 'Connection checklist' })).toContainText('Your hosting operator:')
  await expect(page.getByRole('region', { name: 'Connection checklist' })).toContainText(
    'Keep the existing nameservers',
  )
  const host = `browser-${Date.now()}.example.org`
  await page.getByLabel('Hostname', { exact: true }).fill(host)
  await expect(
    page.getByRole('checkbox', { name: 'Also connect the matching www or non-www address' }),
  ).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Also connect the matching www or non-www address' }).check()
  await page.getByRole('button', { name: 'Connect domain', exact: true }).click()
  const domain = page.getByRole('region', { name: `Domain ${host}`, exact: true })
  await expect(domain).toContainText('Waiting for DNS')
  await runConnection(host)
  await page.getByRole('button', { name: 'Refresh domain status' }).click()
  await expect(domain.getByText('Live', { exact: true })).toBeVisible()
  const reader = await browser.newContext({ timezoneId: 'Asia/Tokyo' })
  try {
    const reopened = await reader.newPage()
    await signIn(reopened, 'root@example.test')
    const errors: string[] = []
    reopened.on('pageerror', error => errors.push(error.message))
    await reopened.goto(sitePath + '/domains')
    const connected = reopened.getByRole('region', { name: `Domain ${host}`, exact: true })
    await connected.getByRole('button', { name: 'Remove domain', exact: true }).click()
    const confirm = reopened.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(errors).toEqual([])
    await expect(connected).toContainText(/Last checked: .+ Eastern time/)
    await connected.getByText('Status history', { exact: true }).click()
    await expect(connected.locator('details ol').first()).toContainText('Eastern time')
  } finally {
    await reader.close()
  }
  await expect(domain.getByRole('table')).toContainText(`_cms-verify.${host}`)
  const folder = resolve('../.r8-progress/admin-domains')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await domain.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(folder, 'domains-' + width + '.png') })
  }
  await expect(domain.getByRole('row').filter({ hasText: '192.0.2.1' })).toContainText('Remove')
  await expect(domain.getByRole('row').filter({ hasText: 'pki.goog' })).toContainText('Add')
  expect((await rawRequest({ host, path: '/' })).status).toBe(200)
  const redirect = await rawRequest({ host: `www.${host}`, path: '/' })
  expect(redirect.status).toBe(308)
  expect(redirect.headers['location']).toBe(`https://${host}/`)
  // Alias routing retains every query value and repeated key. Next may
  // normalize equivalent space encodings at ingress (%20 becomes +).
  const query = '?tag=first&tag=second&value=a%2Bb+c%20d&encoded=%26%3D%23&empty=&next=https%3A%2F%2Foutside.example%2F'
  for (const method of ['GET', 'HEAD']) {
    const queried = await rawRequest({ host: `www.${host}`, path: `/${query}`, method })
    expect(queried.status).toBe(308)
    const destination = new URL(queried.headers['location']!)
    expect(destination.origin).toBe(`https://${host}`)
    expect(destination.pathname).toBe('/')
    expect(destination.hash).toBe('')
    expect(destination.username).toBe('')
    expect(destination.password).toBe('')
    expect([...destination.searchParams.entries()]).toEqual([
      ['tag', 'first'],
      ['tag', 'second'],
      ['value', 'a+b c d'],
      ['encoded', '&=#'],
      ['empty', ''],
      ['next', 'https://outside.example/'],
    ])
    expect(queried.body).toBe('')
  }
  await domain.getByRole('button', { name: 'Remove domain', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByLabel(`Type ${host} to confirm`).fill('incorrect')
  await dialog.getByRole('button', { name: 'Remove domain', exact: true }).click()
  await expect(dialog).toContainText('type the hostname to confirm removal')
  await dialog.getByLabel(`Type ${host} to confirm`).fill(host)
  // SPEC §9.3: a removed domain stops serving within 60s (app routing; DNS and certificates excluded).
  const removing = Date.now()
  await dialog.getByRole('button', { name: 'Remove domain', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  let stopped = Number.POSITIVE_INFINITY
  while (Date.now() - removing < 60_000) {
    if ((await rawRequest({ host, path: '/' })).status === 404) {
      stopped = Date.now() - removing
      break
    }
    await page.waitForTimeout(100)
  }
  console.log(`BUDGET removed-domain ${JSON.stringify({ removalToNotFoundMs: stopped })}`)
  expect(stopped).toBeLessThanOrEqual(60_000)
  expect((await rawRequest({ host, path: '/' })).status).toBe(404)
  expect((await rawRequest({ host: `www.${host}`, path: '/' })).status).toBe(404)
  await runConnection(host)
  await page.getByRole('button', { name: 'Refresh domain status' }).click()
  await expect(domain.getByText('Removed', { exact: true })).toBeVisible()
})
async function setContributorRole(role: 'site_admin' | 'contributor') {
  const pool = new Pool({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
  const client = await pool.connect()
  try {
    const root = (await client.query<{ id: string }>("SELECT id FROM app_users WHERE email='root@example.test'"))
      .rows[0]!.id
    const user = (await client.query<{ id: string }>("SELECT id FROM app_users WHERE email='contributor@example.test'"))
      .rows[0]!.id
    const site = (await client.query<{ id: string }>("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [user, site, role])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
for (const [label, email, siteAdmin] of [
  ['editors', 'editor@example.test', false],
  ['contributors', 'contributor@example.test', false],
  ['site administrators', 'contributor@example.test', true],
] as const)
  test(`lets ${label} inspect domains while reserving every management control for Super Admins`, async ({ page }) => {
    if (siteAdmin) await setContributorRole('site_admin')
    try {
      await signIn(page, email)
      const sitePath = await page
        .getByRole('main')
        .getByRole('link', { name: 'Demo site', exact: true })
        .getAttribute('href')
      await page.goto(sitePath + '/domains')
      await expect(page.getByRole('link', { name: 'Domains', exact: true })).toHaveAttribute('aria-current', 'page')
      await expect(
        page.getByText('Only a Super Admin can connect, verify, change or remove domains.', { exact: false }),
      ).toBeVisible()
      for (const name of ['Connect domain', 'Verify now', 'Make primary', 'Remove domain', 'Retry cleanup']) {
        await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
      }
    } finally {
      if (siteAdmin) await setContributorRole('contributor')
    }
  })
