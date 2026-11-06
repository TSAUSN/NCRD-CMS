import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { e2eTarget } from '../test-target.ts'
const run = promisify(execFile)
test('owner-captured text publishes normally, preserves ministry copy and retains genuine sample warnings', async ({
  browser,
}) => {
  test.setTimeout(240000)
  const target = e2eTarget(),
    base = `postgres://cms:cms@${target.host}:${target.port}/${target.database}`,
    pool = new Pool({ connectionString: base })
  let siteId: string | undefined
  try {
    const { stdout } = await run(
      process.execPath,
      [
        '--conditions=react-server',
        '--experimental-strip-types',
        '--no-warnings',
        'e2e/fixtures/sawso-owner-content-runner.ts',
      ],
      {
        cwd: resolve('..'),
        env: {
          ...process.env,
          DATABASE_URL: base,
          DATABASE_URL_AUTHENTICATED: `postgres://cms_admin_app:devpassword@${target.host}:${target.port}/${target.database}`,
          DATABASE_URL_WORKER: `postgres://cms_worker_app:devpassword@${target.host}:${target.port}/${target.database}`,
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    const fixture = JSON.parse(stdout.trim().split('\n').at(-1)!),
      site = { hostname: fixture.hostname }
    siteId = fixture.siteId
    expect(fixture.protectedSame).toBe(true)
    const payload = JSON.parse(await readFile(resolve('../demo/sawso-content/content.json'), 'utf8'))
    const context = await browser.newContext({ javaScriptEnabled: false }),
      view = await context.newPage(),
      origin = 'http://' + site.hostname + `:${E2E_PORTS.site}`,
      remote: string[] = []
    view.on('request', request => {
      if (!new URL(request.url()).hostname.endsWith('.localhost')) remote.push(request.url())
    })
    try {
      await view.goto(origin + '/stories/life-in-ukraine-years-into-war')
      await expect(view.locator('.core-story-text')).toContainText(
        'Years into the war, daily life for families across Ukraine',
      )
      await expect(view.locator('.core-story-text')).not.toContainText('Story text — sample content')
      const venezuela = payload.stories.find((s: { title: string }) => s.title.includes('deadly earthquakes'))!
      await view.goto(origin + '/stories/venezuela-earthquake-june-2026')
      await expect(view.locator('.core-story-text')).toContainText(
        venezuela.body
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(-100),
      )
      await view.goto(origin + '/our-team')
      await expect(view.getByRole('heading', { name: payload.team[0]!.name, exact: true })).toBeVisible()
      await expect(view.getByText(payload.team[0]!.role, { exact: true })).toBeVisible()
      await view.goto(origin + '/annual-reports')
      await expect(view.getByRole('link', { name: payload.reports[0]!.label, exact: true })).toHaveAttribute(
        'href',
        payload.reports[0]!.url,
      )
      await view.goto(origin + '/financial-accountability')
      await expect(view.locator('main')).toContainText('devotes 97% of its total expenditures')
      await expect(view.getByRole('link', { name: 'Privacy Policy', exact: true })).toHaveAttribute(
        'href',
        payload.privacy,
      )
      expect(remote).toEqual([])
    } finally {
      await context.close()
    }
  } finally {
    if (siteId) await pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [siteId])
    await pool.end()
  }
})
