// BT2027's remaining eight local marketing pages. Never fetch the live site.
import { createHash } from 'node:crypto'
import { chromium, firefox, webkit, expect } from './node_modules/@playwright/test/index.mjs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from '../packages/importer/node_modules/sharp/dist/index.mjs'
const selected = process.argv.find(arg => arg.startsWith('--page='))?.slice(7)
const engine = process.argv[2] ?? 'chromium',
  browser = await { chromium, firefox, webkit }[engine].launch(),
  folder = resolve(
    process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? '.r8-progress/step-5/remaining/' + engine,
  )
await mkdir(folder, { recursive: true })
const receipts = JSON.parse(await readFile('.r8-progress/step-5/vendor-cache/receipts.json', 'utf8')),
  cache = new Map(
    receipts.flatMap(r => [
      [r.source, r],
      [r.final, r],
    ]),
  ),
  report = { engine, pages: [], missing: new Set(), errors: [] }
const pages = [
  'exhibitors.php',
  'hotel-information.php',
  'kansas-city.php',
  'sponsorship.php',
  'registration-FAQs.php',
  'privacy-policy.php',
  'manifesto.html',
  'workshops.html',
]
async function context(width) {
  const c = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 768 } })
  await c.route('**/*', async route => {
    const u = new URL(route.request().url()),
      r = cache.get(u.href)
    if (r) {
      if (!/^[a-f0-9]{64}\.bin$/.test(r.file)) throw new Error('Invalid cache receipt.')
      const bytes = await readFile(resolve('.r8-progress/step-5/vendor-cache', r.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(r.hash)
      expect(bytes.length).toBe(r.bytes)
      return route.fulfill({ status: 200, contentType: r.type, body: bytes })
    }
    if (u.hostname === 'bettertogether2027.org')
      return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:8099' + u.pathname + u.search }) })
    if (u.hostname === '127.0.0.1' || u.hostname.endsWith('.localhost')) return route.continue()
    if (!/google-analytics|googletagmanager/.test(u.hostname)) report.missing.add(u.origin + u.pathname)
    return route.abort()
  })
  return c
}
async function load(page, url) {
  page.on('pageerror', e =>
    report.errors.push({
      side: url.includes('staging.localhost') ? 'cms' : 'reference',
      page: new URL(url).pathname,
      error: e.message,
    }),
  )
  if (/manifesto/.test(url)) await page.clock.install({ time: new Date('2026-10-27T12:00:00Z') })
  else await page.clock.setFixedTime(new Date('2026-10-27T12:00:00Z'))
  const response = await page.goto(url, { waitUntil: 'networkidle' })
  expect(response.status()).toBe(200)
  if (url.includes('staging.localhost')) {
    expect(await page.locator('script:not([src])').count()).toBe(0)
    expect(
      await page
        .locator('script[src]')
        .evaluateAll(nodes => nodes.every(n => new URL(n.src).origin === location.origin)),
    ).toBe(true)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))))
  if (/manifesto/.test(url)) await page.clock.pauseAt(new Date('2026-10-27T12:00:03Z'))
}
async function scroll(page, top) {
  await page.evaluate(y => {
    const b = document.body,
      style = getComputedStyle(b)
    if (/auto|scroll/.test(style.overflowY) && b.scrollHeight > b.clientHeight + 1)
      b.scrollTo({ top: y, behavior: 'instant' })
    else window.scrollTo({ top: y, behavior: 'instant' })
  }, top)
}
async function capture(page, path, width) {
  const height = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)),
    view = width === 1440 ? 900 : 768,
    parts = []
  let y = 0
  while (y < height) {
    await scroll(page, y === 0 ? 0 : y - 140)
    await page.waitForTimeout(80)
    const actual = await page.evaluate(() => Math.max(window.scrollY, document.body.scrollTop)),
      top = Math.round(y - actual),
      h = Math.floor(Math.min(view - top, height - y))
    if (h <= 0) throw new Error('Cannot capture the actual scroll container.')
    const shot = await page.screenshot({ animations: 'disabled' })
    parts.push({ input: await sharp(shot).extract({ left: 0, top, width, height: h }).toBuffer(), left: 0, top: y })
    y += h
  }
  await sharp({ create: { width, height, channels: 3, background: '#fff' } })
    .composite(parts)
    .png()
    .toFile(path)
  await scroll(page, 0)
}
const geometry = page =>
  page.evaluate(() =>
    [...document.body.children]
      .filter(e => !['SCRIPT', 'STYLE', 'LINK'].includes(e.tagName))
      .map(e => ({
        tag: e.tagName,
        class: e.className,
        id: e.id,
        x: Math.round(e.getBoundingClientRect().x),
        y: Math.round(e.getBoundingClientRect().y),
        width: Math.round(e.getBoundingClientRect().width),
        height: Math.round(e.getBoundingClientRect().height),
      })),
  )
try {
  for (const source of pages.filter(page => !selected || page === selected)) {
    const slug = source.replace(/\.(?:php|html)$/, '').toLowerCase()
    for (const width of [1440, 1024, 390]) {
      const c = await context(width),
        reference = await c.newPage(),
        cms = await c.newPage()
      await load(reference, 'http://127.0.0.1:8099/' + source)
      await load(cms, 'http://bt2027-r8.staging.localhost:3001/' + slug)
      const result = {
        source,
        slug,
        width,
        reference: await geometry(reference),
        cms: await geometry(cms),
        behavior: {},
      }
      for (const [name, page] of [
        ['reference', reference],
        ['cms', cms],
      ]) {
        await capture(page, resolve(folder, slug + '-' + name + '-' + width + '.png'), width)
        if (width === 390 && (await page.locator('.navbar-toggler').count())) {
          await page.locator('.navbar-toggler').click()
          await page.waitForTimeout(700)
          const menu = page.locator('.navbar-collapse')
          await expect(menu).toHaveClass(source === 'workshops.html' ? /open/ : /show/)
          await page.screenshot({ path: resolve(folder, slug + '-' + name + '-menu-390.png') })
          await page.locator('.navbar-toggler').click()
          await page.waitForTimeout(700)
          result.behavior[name] = { menu: true }
        }
        if (source === 'hotel-information.php') {
          const trigger = page.locator('[data-bs-target="#hotelMapModal"]').first()
          await trigger.scrollIntoViewIfNeeded()
          await trigger.click()
          await page.waitForTimeout(700)
          await expect(page.locator('#hotelMapModal')).toBeVisible()
          await page.screenshot({ path: resolve(folder, slug + '-' + name + '-popup-' + width + '.png') })
          await page.locator('#hotelMapModal [data-bs-dismiss="modal"]').first().click()
          await page.waitForTimeout(700)
          await expect(page.locator('#hotelMapModal')).not.toBeVisible()
          const details = page.locator('details').first()
          await details.locator('summary').click()
          await expect(details).toHaveAttribute('open', '')
          await details.scrollIntoViewIfNeeded()
          await page.screenshot({ path: resolve(folder, slug + '-' + name + '-faq-' + width + '.png') })
          result.behavior[name] = { ...result.behavior[name], popup: true, faq: true }
        }
        if (source === 'workshops.html') {
          const search = page.locator('.fixed-table-toolbar .search input')
          await search.fill('')
          await search.pressSequentially('Herth')
          await page.waitForTimeout(800)
          await expect(page.locator('#table tbody tr')).toHaveCount(1)
          await expect(page.locator('#table tbody')).toContainText('Herth Hope')
          await page.screenshot({ path: resolve(folder, slug + '-' + name + '-search-' + width + '.png') })
          await search.fill('')
          await search.press('Backspace')
          await page.waitForTimeout(800)
          const filter = page.locator('select.bootstrap-table-filter-control-ConferenceFocus')
          const option = await filter
            .locator('option')
            .evaluateAll(nodes => nodes.find(n => n.value === 'Social Services')?.value)
          expect(option).toBe('Social Services')
          await filter.selectOption(option)
          await page.waitForTimeout(800)
          const focuses = await page.locator('#table tbody tr td:nth-child(3)').allTextContents()
          expect(focuses.length).toBeGreaterThan(0)
          expect(focuses.every(text => text.trim() === 'Social Services')).toBe(true)
          await page.screenshot({ path: resolve(folder, slug + '-' + name + '-filter-' + width + '.png') })
          await search.fill('')
          await search.pressSequentially('zz-no-workshop-match')
          await page.waitForTimeout(800)
          await expect(page.locator('#table tbody')).toContainText('No matching records found')
          await page.screenshot({ path: resolve(folder, slug + '-' + name + '-empty-' + width + '.png') })
          result.behavior[name] = { ...result.behavior[name], search: true, filter: true, empty: true }
        }
        if (source === 'manifesto.html') {
          const before = await page.locator('#colorShift').evaluate(e => getComputedStyle(e).backgroundColor)
          await page.clock.runFor(4100)
          const after = await page.locator('#colorShift').evaluate(e => getComputedStyle(e).backgroundColor)
          expect(after).not.toBe(before)
          result.behavior[name] = { colorAnimation: true }
        }
        const hover = page.locator('a.btn-solid-reg').first()
        if (await hover.count()) {
          await hover.scrollIntoViewIfNeeded()
          await page.mouse.move(0, 0)
          await page.waitForTimeout(800)
          const before = await hover.evaluate(e => ({
            color: getComputedStyle(e).color,
            background: getComputedStyle(e).backgroundColor,
            border: getComputedStyle(e).borderColor,
          }))
          await hover.hover()
          await page.waitForTimeout(800)
          const after = await hover.evaluate(e => ({
            color: getComputedStyle(e).color,
            background: getComputedStyle(e).backgroundColor,
            border: getComputedStyle(e).borderColor,
          }))
          expect(after).not.toEqual(before)
          result.behavior[name] = { ...result.behavior[name], hover: { before, after } }
        }
      }
      const ref = resolve(folder, slug + '-reference-' + width + '.png'),
        out = resolve(folder, slug + '-cms-' + width + '.png'),
        a = await sharp(ref).metadata(),
        b = await sharp(out).metadata()
      await sharp({
        create: { width: width * 2, height: Math.max(a.height, b.height), channels: 3, background: '#ddd' },
      })
        .composite([
          { input: ref, left: 0, top: 0 },
          { input: out, left: width, top: 0 },
        ])
        .png()
        .toFile(resolve(folder, slug + '-side-by-side-' + width + '.png'))
      report.pages.push(result)
      console.log(slug, width, 'captured and checked')
      await c.close()
    }
  }
  expect(
    report.errors.filter(
      e => !/^\$\((?:\.\.\.|'\.popup-with-move-anim')\)\.magnificPopup is not a function(?:\.|$)/.test(e.error),
    ),
  ).toEqual([])
  expect(report.errors.filter(e => e.side === 'cms').length).toBe(
    report.errors.filter(e => e.side === 'reference').length,
  )
} finally {
  await writeFile(
    resolve(folder, selected ? 'report-' + selected + '.json' : 'report.json'),
    JSON.stringify({ ...report, missing: [...report.missing] }, null, 2),
  )
  await browser.close()
}
console.log(
  JSON.stringify(
    { engine, comparisons: report.pages.length, errors: report.errors, missing: [...report.missing] },
    null,
    2,
  ),
)
