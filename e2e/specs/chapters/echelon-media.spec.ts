import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { e2eTarget } from '../../test-target.ts'
import { echelonFixture } from '../fixtures/echelon.ts'
import { signIn } from '../helpers.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
const run = promisify(execFile)
test('Echelon reference import uses normal Media uploads, keeps focus/descriptions, refuses changed or foreign inputs and repeats without duplicates', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false),
    target = e2eTarget(),
    folder = resolve('../.r8-progress/round3/echelon-media/' + info.project.name),
    store = createFilesystemMediaStore(defaultMediaRoot())
  let objects: string[] = []
  try {
    const foreign = (await f.pool.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id,
      { stdout } = await run(
        process.execPath,
        [
          '--conditions=react-server',
          '--experimental-strip-types',
          '--no-warnings',
          'e2e/fixtures/echelon-media-runner.ts',
          f.actor,
          f.site,
          foreign,
        ],
        {
          cwd: resolve('..'),
          env: {
            ...process.env,
            CMS_LOCAL_TEST_MODE: 'true',
            MEDIA_PROVIDER: 'filesystem',
            MEDIA_ROOT: defaultMediaRoot(),
            ADMIN_ORIGIN: `http://127.0.0.1:${E2E_PORTS.admin}`,
            DATABASE_URL: `postgres://cms:cms@${target.host}:${target.port}/${target.database}`,
            DATABASE_URL_AUTHENTICATED: `postgres://cms_admin_app:devpassword@${target.host}:${target.port}/${target.database}`,
            DATABASE_URL_WORKER: `postgres://cms_worker_app:devpassword@${target.host}:${target.port}/${target.database}`,
          },
          maxBuffer: 1024 * 1024,
        },
      ),
      result = JSON.parse(stdout.trim().split('\n').at(-1)!)
    objects = result.objects
    expect(result).toMatchObject({
      verifiedRepeat: true,
      changedSourceRefused: true,
      foreignSiteRefused: true,
      readyVariants: 3,
      sourceChecks: 0,
    })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/media')
    await expect(page.getByRole('heading', { name: 'Media', exact: true })).toBeVisible()
    await expect(page.getByText('[Reference photo].png', { exact: true })).toBeVisible()
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'imported-' + width + '.png') })
    }
  } finally {
    await f.archive()
    f.client.release()
    await f.pool.end()
    for (const key of objects) await store.remove(key)
  }
})
