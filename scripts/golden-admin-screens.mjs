import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { writeFileSync, readFileSync } from 'node:fs'
import { target, privateDirectory, fixture, applications, localCookie, root } from './golden/local.mjs'
import { adminReady } from './golden/admin-ready.mjs'
import { adminRoutes } from './golden/admin-routes.mjs'
import { screenEvidence, compareScreens, differentPixels } from './golden/admin-evidence.mjs'
const { webkit } = createRequire(join(root, 'e2e/package.json'))('@playwright/test')
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
  let engine
  const captures = [],
    failures = []
  try {
    browser = await webkit.launch({ headless: true })
    engine = { name: 'webkit', version: browser.version() }
    if (reference && JSON.stringify(reference.engine) !== JSON.stringify(engine))
      throw Error('Re-capture the pristine screens with this same browser version before comparing.')
    const height = 1000
    for (const width of [1440, 1024, 900]) {
      async function contextFor(engine) {
        const context = await engine.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
        await context.route('**/*', route => {
          const u = new URL(route.request().url())
          return ['127.0.0.1', 'localhost'].includes(u.hostname) ||
            u.hostname.endsWith('.localhost') ||
            u.protocol === 'data:'
            ? route.continue()
            : route.abort()
        })
        return context
      }
      const shared = await contextFor(browser)
      for (const [index, row] of catalog.cases.entries()) {
        const isEditor = /^\/pages\/[a-f0-9-]+$/.test(row.path)
        // A scaled canvas can use a lower-quality bitmap after earlier pages
        // have used the same WebKit renderer. Start editor captures fresh.
        const editorBrowser = isEditor ? await webkit.launch({ headless: true }) : null
        const context = editorBrowser ? await contextFor(editorBrowser) : shared
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
          await page.waitForLoadState('networkidle')
          if (isEditor) {
            // The editor scales the canvas down. Its visible inner viewport
            // can extend beyond the first 1,000 CSS pixels.
            const element = await page.locator('iframe[title="Page canvas"]').elementHandle()
            const canvas = await element?.contentFrame()
            if (!canvas) throw Error('The ready editor canvas frame disappeared.')
            await Promise.race([
              canvas.evaluate(async () => {
                await document.fonts.ready
                const images = Array.from(document.images).filter(image => {
                  const rect = image.getBoundingClientRect()
                  return rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight
                })
                await Promise.all(images.map(image => image.decode()))
              }),
              new Promise((_, reject) => {
                setTimeout(() => reject(Error('Visible editor canvas images did not decode.')), 5000).unref()
              }),
            ])
          }
          // adminReady already waits for visible preview frame assets. WebKit
          // can suspend animation callbacks in preview frames; only wait for a
          // final paint in the top document.
          await Promise.race([
            page.evaluate(async () => {
              await document.fonts.ready
              const visible = Array.from(document.images).filter(img => {
                const rect = img.getBoundingClientRect()
                return rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight
              })
              await Promise.allSettled(visible.map(img => img.decode()))
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            }),
            new Promise((_, reject) => {
              setTimeout(() => reject(Error('Visible admin raster did not settle.')), 5000).unref()
            }),
          ])
          const screenshot = () => page.screenshot({ animations: 'disabled', scale: 'css' })
          let image = await screenshot()
          if (isEditor) {
            let stable = false
            // WebKit can temporarily lower image interpolation while a frame
            // is resizing. Taking another screenshot within its 500 ms
            // repaint window can keep that low-quality frame alive. Let the
            // browser repaint before comparing two unmodified captures.
            for (let attempt = 0; attempt < 5; attempt++) {
              await page.waitForTimeout(1000)
              const next = await screenshot()
              stable = differentPixels(image, next) === 0
              image = next
              if (stable) break
            }
            if (!stable) throw Error('The editor canvas did not reach two identical frames.')
          }
          writeFileSync(join(out, file), image, { mode: 0o600 })
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          )
          const evidence = await screenEvidence(page)
          captures.push({
            ...row,
            width,
            file,
            overflow,
            ...evidence,
            heading: await page.getByRole('heading').allTextContents(),
          })
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
          await editorBrowser?.close()
        }
      }
      await shared.close()
    }
  } finally {
    try {
      await browser?.close()
    } finally {
      await stop()
    }
  }
  const comparisons = reference ? compareScreens(resolve(option('--reference')), reference, out, captures) : null
  const receipt = {
    at,
    database: t.database,
    ports: t.ports,
    routePatterns: catalog.cases.length,
    excluded: catalog.excluded,
    captures,
    failures,
    externalRequests: 'Blocked; only local fixture hosts are allowed.',
    clock: 'Natural browser clock; preview readiness depends on native navigation timing.',
    masks: [],
    engine,
    comparisons,
  }
  writeFileSync(join(out, 'screens.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
  console.log(
    JSON.stringify(
      {
        routePatterns: catalog.cases.length,
        captures: captures.length,
        failures,
        comparisons,
        excluded: catalog.excluded,
      },
      null,
      2,
    ),
  )
  if (failures.length || comparisons?.differences.length) process.exitCode = 1
}
main().catch(error => {
  console.error(
    String(error.message)
      .split('\n')[0]
      .replace(/https?:\/\/\S+/g, '[private URL omitted]'),
  )
  process.exitCode = 1
})
