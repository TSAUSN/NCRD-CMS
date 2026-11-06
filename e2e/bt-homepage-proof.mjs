// Local BT2027 homepage proof only. Run from the repository root after the
// Super Admin import/release, with the existing offline cache and PHP on8099.
// External requests are fulfilled from verified local cache or aborted.
import { createHash } from 'node:crypto'
import { chromium, firefox, webkit, expect } from './node_modules/@playwright/test/index.mjs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from '../packages/importer/node_modules/sharp/dist/index.mjs'
const engine = process.argv[2] ?? 'chromium',
  browser = await { chromium, firefox, webkit }[engine].launch(),
  folder = resolve(
    process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? '.r8-progress/step-5/homepage/' + engine,
  )
await mkdir(folder, { recursive: true })
const receipts = JSON.parse(await readFile('.r8-progress/step-5/vendor-cache/receipts.json', 'utf8')),
  cache = new Map(
    receipts.flatMap(r => [
      [r.source, r],
      [r.final, r],
    ]),
  ),
  report = { engine, widths: [], missing: new Set(), errors: [], behavior: {} }
async function context(width, js = true) {
  const c = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 768 }, javaScriptEnabled: js })
  c.setDefaultTimeout(15000)
  c.setDefaultNavigationTimeout(30000)
  await c.route('**/*', async route => {
    const u = new URL(route.request().url()),
      r = cache.get(u.href)
    if (r) {
      if (!/^[a-f0-9]{64}\.bin$/.test(r.file)) throw new Error('Invalid offline receipt.')
      const bytes = await readFile(resolve('.r8-progress/step-5/vendor-cache', r.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(r.hash)
      expect(bytes.length).toBe(r.bytes)
      return route.fulfill({ status: 200, contentType: r.type, body: bytes })
    }
    if (u.hostname === 'bettertogether2027.org')
      return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:8099' + u.pathname + u.search }) })
    if (u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost')) return route.continue()
    if (!u.hostname.includes('google-analytics') && !u.hostname.includes('googletagmanager')) report.missing.add(u.href)
    return route.abort()
  })
  return c
}
async function load(page, url) {
  page.on('pageerror', e => report.errors.push({ url, error: e.message }))
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00Z'))
  const response = await page.goto(url, { waitUntil: 'networkidle' })
  if (url.includes('bt2027-r8.staging.localhost')) {
    expect(response.headers()['content-security-policy']).toContain("'sha256-")
    expect(await page.locator('script:not([src])').count()).toBe(0)
    expect(
      await page
        .locator('script[src]')
        .evaluateAll(nodes => nodes.every(n => new URL(n.src).origin === location.origin)),
    ).toBe(true)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))))
  await page.waitForTimeout(1000)
}
async function captureScrolled(page, path, width) {
  await page.locator('.bt-dot').first().dispatchEvent('click')
  await page.locator('.bt-clean-carousel').dispatchEvent('mouseenter')
  const height = await page.evaluate(() => document.body.scrollHeight),
    view = width === 1440 ? 900 : 768,
    parts = []
  let y = 0
  while (y < height) {
    const desired = y === 0 ? 0 : y - 140
    await page.evaluate(top => document.body.scrollTo({ top, behavior: 'instant' }), desired)
    await page.waitForTimeout(1250)
    const actual = await page.evaluate(() => document.body.scrollTop),
      top = y - actual,
      h = Math.min(view - top, height - y)
    if (Math.floor(h) <= 0) throw new Error('The source scrolling container did not move.')
    const shot = await page.screenshot({ animations: 'disabled' })
    parts.push({
      input: await sharp(shot)
        .extract({ left: 0, top: Math.round(top), width, height: Math.floor(h) })
        .toBuffer(),
      left: 0,
      top: y,
    })
    y += Math.floor(h)
  }
  await sharp({ create: { width, height, channels: 3, background: '#fff' } })
    .composite(parts)
    .png()
    .toFile(path)
  await page.evaluate(() => document.body.scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForTimeout(300)
}
try {
  for (const width of process.argv.includes('--no-js-only') ? [] : [1440, 1024, 390]) {
    console.log('Starting', width)
    const c = await context(width),
      reference = await c.newPage(),
      cms = await c.newPage()
    await load(reference, 'http://127.0.0.1:8099/')
    await load(cms, 'http://bt2027-r8.staging.localhost:3001/')

    console.log('Loaded', width)
    const refPath = resolve(folder, 'reference-' + width + '.png'),
      cmsPath = resolve(folder, 'cms-' + width + '.png')
    await captureScrolled(reference, refPath, width)
    await captureScrolled(cms, cmsPath, width)
    const a = await sharp(refPath).metadata(),
      b = await sharp(cmsPath).metadata()
    await sharp({ create: { width: width * 2, height: Math.max(a.height, b.height), channels: 3, background: '#ddd' } })
      .composite([
        { input: refPath, left: 0, top: 0 },
        { input: cmsPath, left: width, top: 0 },
      ])
      .png()
      .toFile(resolve(folder, 'side-by-side-' + width + '.png'))
    console.log('Captured', width)
    const measures = async page =>
      page.evaluate(() =>
        [...document.body.children]
          .filter(e => !['SCRIPT', 'STYLE', 'LINK'].includes(e.tagName))
          .map(e => ({
            tag: e.tagName,
            id: e.id,
            class: e.className,
            x: Math.round(e.getBoundingClientRect().x),
            y: Math.round(e.getBoundingClientRect().y),
            width: Math.round(e.getBoundingClientRect().width),
            height: Math.round(e.getBoundingClientRect().height),
          })),
      )
    report.widths.push({ width, reference: await measures(reference), cms: await measures(cms) })
    const result = {}
    for (const [name, page] of [
      ['reference', reference],
      ['cms', cms],
    ]) {
      console.log('Popup check', width, name)
      await page.locator('.hero-cta').scrollIntoViewIfNeeded()
      await page.locator('.hero-cta').click()
      await page.waitForTimeout(600)
      await expect(page.locator('#registerModal')).toBeVisible()
      await page.screenshot({ path: resolve(folder, name + '-popup-' + width + '.png') })
      await page.locator('#registerModal [data-bs-dismiss="modal"]').first().click()
      await page.waitForTimeout(600)
      await expect(page.locator('#registerModal')).not.toBeVisible()
      if (width === 390) {
        await page.evaluate(() => document.body.scrollTo({ top: 0, behavior: 'instant' }))
        await page.locator('.navbar-toggler').click()
        await page.waitForTimeout(600)
        await expect(page.locator('.navbar-collapse')).toHaveClass(/show/)
        await page.screenshot({ path: resolve(folder, name + '-menu-390.png') })
        await page.locator('.navbar-toggler').click()
        await page.waitForTimeout(600)
      }
      const speaker = page.locator('.speaker-card').first()
      await speaker.scrollIntoViewIfNeeded()
      await speaker.click()
      const detail = page.locator('.speaker-detail.is-open')
      await expect(detail).toBeVisible()
      await expect(detail.locator('.speaker-detail-name')).toHaveText('LoLo Jones')
      await expect(detail.locator('.speaker-detail-bio')).toContainText('World Championships')
      await detail.scrollIntoViewIfNeeded()
      await page.waitForTimeout(600)
      await page.screenshot({ path: resolve(folder, name + '-speaker-bio-' + width + '.png') })
      await detail.locator('.speaker-detail-close').click()
      await expect(page.locator('.speaker-detail.is-open')).toHaveCount(0)
      await page.waitForTimeout(600)
      console.log('Carousel check', width, name)
      await page.locator('.bt-clean-carousel').scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      await page.locator('.bt-clean-carousel').dispatchEvent('mouseleave')
      const before = await page.locator('.bt-carousel-track').evaluate(e => e.style.transform)
      await page.waitForTimeout(5100)
      const after = await page.locator('.bt-carousel-track').evaluate(e => e.style.transform)
      expect(after).not.toBe(before)
      result[name] = { carousel: { before, after }, popup: true, speakerBio: true, mobileMenu: width === 390 }
      await page.locator('.hero-cta').scrollIntoViewIfNeeded()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(400)
      await page.waitForTimeout(550)
      const base = await page.locator('.hero-cta').evaluate(e => ({
        background: getComputedStyle(e).backgroundColor,
        transform: getComputedStyle(e).transform,
        beforeWidth: getComputedStyle(e, '::before').width,
      }))
      await page.locator('.hero-cta').hover()
      await page.waitForTimeout(400)
      await page.waitForTimeout(550)
      const hover = await page.locator('.hero-cta').evaluate(e => ({
        background: getComputedStyle(e).backgroundColor,
        transform: getComputedStyle(e).transform,
        beforeWidth: getComputedStyle(e, '::before').width,
      }))
      expect(hover).not.toEqual(base)
      result[name].hover = { base, hover }
    }
    report.behavior[width] = result
    await c.close()
  }
  const c = await context(390, false),
    p = await c.newPage()
  await p.goto('http://bt2027-r8.staging.localhost:3001/')
  await expect(p.locator('.hero-sub')).toContainText('2,500')
  await expect(p.locator('.speaker-card')).not.toHaveCount(0)
  await expect(p.locator('.animate-on-scroll').first()).toHaveCSS('opacity', '1')
  await captureScrolled(p, resolve(folder, 'cms-no-js-390.png'), 390)
  await c.close()
  expect(report.errors).toEqual([])
} finally {
  await writeFile(
    resolve(folder, process.argv.includes('--no-js-only') ? 'no-js-report.json' : 'report.json'),
    JSON.stringify({ ...report, missing: [...report.missing] }, null, 2),
  )
  await browser.close()
}
console.log(
  JSON.stringify(
    {
      engine,
      errors: report.errors,
      widths: report.widths.map(r => ({ width: r.width, referenceRoots: r.reference.length, cmsRoots: r.cms.length })),
      behavior: report.behavior,
      missing: [...report.missing],
    },
    null,
    2,
  ),
)
