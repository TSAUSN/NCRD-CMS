import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { writeFileSync, readFileSync } from 'node:fs'
import { target, privateDirectory, fixture, applications, localCookie, root } from './golden/local.mjs'
import { adminReady } from './golden/admin-ready.mjs'
import { adminRoutes } from './golden/admin-routes.mjs'
const { chromium, expect } = createRequire(join(root, 'e2e/package.json'))('@playwright/test')
const args = process.argv.slice(2),
  option = key => args[args.indexOf(key) + 1]
async function main() {
  if (!args.includes('--out') || !args.includes('--media-root'))
    throw Error(
      'Supply private --out and reviewed --media-root; optional --reference checks the original route catalog.',
    )
  const t = target(),
    out = privateDirectory(option('--out')),
    data = await fixture(t),
    catalog = await adminRoutes(t, data)
  if (t.database !== 'cms_e2e_refactor_screens')
    throw Error(
      'Admin captures require the separate cms_e2e_refactor_screens fixture, preserving render-oracle tickets.',
    )
  const reference = args.includes('--reference')
    ? JSON.parse(readFileSync(join(resolve(option('--reference')), 'screens.json'), 'utf8'))
    : null
  if (
    reference &&
    JSON.stringify(reference.captures.filter(c => c.width === 1440).map(c => c.pattern)) !==
      JSON.stringify(catalog.cases.map(c => c.pattern))
  )
    throw Error('Admin route catalog differs from baseline.')
  const at = new Date().toISOString(),
    stop = await applications(t, out, option('--media-root'))
  let browser
  const captures = [],
    failures = []
  try {
    browser = await chromium.launch({ headless: true })
    for (const width of [1440, 1024]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
      await context.route('**/*', route => {
        const u = new URL(route.request().url())
        return ['127.0.0.1', 'localhost'].includes(u.hostname) ||
          u.hostname.endsWith('.localhost') ||
          u.protocol === 'data:'
          ? route.continue()
          : route.abort()
      })
      for (const [index, row] of catalog.cases.entries()) {
        const page = await context.newPage()
        page.setDefaultTimeout(15000)
        const file = String(index).padStart(2, '0') + '-' + width + '.png'
        if (row.signedIn) {
          const cookie = localCookie(data.owner.email).slice('cms_session='.length)
          await context.addCookies([{ name: 'cms_session', value: cookie, domain: '127.0.0.1', path: '/' }])
        } else await context.clearCookies()
        try {
          const response = await page.goto(`http://127.0.0.1:${t.ports.admin}` + row.path, {
            waitUntil: 'domcontentloaded',
          })
          if (!response?.ok()) throw Error('Admin route HTTP status ' + response?.status())
          await adminReady(page, row)
          await page.screenshot({ path: join(out, file), animations: 'disabled' })
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          )
          captures.push({ ...row, width, file, overflow, heading: await page.getByRole('heading').allTextContents() })
          if (overflow) failures.push({ pattern: row.pattern, width, reason: 'Horizontal overflow', file })
        } catch (error) {
          await page.screenshot({ path: join(out, file), animations: 'disabled' }).catch(() => {})
          failures.push({
            pattern: row.pattern,
            width,
            file,
            reason: error.message.replace(/https?:\/\/\S+/g, '[private URL omitted]'),
          })
        } finally {
          await page.close()
        }
      }
      await context.close()
    }
  } finally {
    try {
      await browser?.close()
    } finally {
      await stop()
    }
  }
  const receipt = {
    at,
    database: t.database,
    ports: t.ports,
    routePatterns: catalog.cases.length,
    excluded: catalog.excluded,
    captures,
    failures,
    externalRequests: 'Blocked; only local fixture hosts are allowed.',
    clock: 'Natural browser clock; no clock instrumentation. Relative time labels require visual review.',
  }
  writeFileSync(join(out, 'screens.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
  console.log(
    JSON.stringify(
      { routePatterns: catalog.cases.length, captures: captures.length, failures, excluded: catalog.excluded },
      null,
      2,
    ),
  )
  if (failures.length) process.exitCode = 1
}
main().catch(error => {
  console.error(
    String(error.message)
      .split('\n')[0]
      .replace(/https?:\/\/\S+/g, '[private URL omitted]'),
  )
  process.exitCode = 1
})
