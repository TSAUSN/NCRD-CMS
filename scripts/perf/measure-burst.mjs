import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, applications, fixture, localCookie, privateDirectory, root, target } from '../golden/local.mjs'
import { adminReady } from '../golden/admin-ready.mjs'

const [folder, mediaRoot, mode = 'autosave'] = process.argv.slice(2)
if (mode !== 'autosave' && mode !== 'checkpoint') throw Error('Choose autosave or checkpoint.')
const t = target()
if (!folder || !mediaRoot || !/^cms_e2e_refactor_burst(?:_autosave|_checkpoint)?$/.test(t.database))
  throw Error(
    'Supply PRIVATE_OUTPUT MEDIA_ROOT and the separate disposable burst fixture. A real draft is saved there.',
  )
const out = privateDirectory(folder)
const traceFile = join(out, 'requests.jsonl')
writeFileSync(traceFile, '', { mode: 0o600, flag: 'wx' })
const { routes, owner } = await fixture(t)
const route = routes.find(row => row.slug === 'sawso' && row.path === '/ways-we-help/education')
if (!route) throw Error('Missing editable performance fixture.')
const { chromium } = createRequire(join(root, 'e2e/package.json'))('@playwright/test')
const stop = await applications(t, out, mediaRoot, { traceFile })
const origin = 'http://127.0.0.1:' + t.ports.admin
const editUrl = origin + '/pages/' + route.page_id

let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    return host === '127.0.0.1' || host.endsWith('.localhost') ? route.continue() : route.abort()
  })
  await context.addCookies([
    {
      name: 'cms_session',
      value: localCookie(owner.email).slice('cms_session='.length),
      domain: '127.0.0.1',
      path: '/',
    },
  ])
  const editor = await context.newPage()
  const nav = await context.newPage()
  editor.setDefaultTimeout(20000)
  nav.setDefaultTimeout(20000)
  await editor.goto(editUrl)
  await adminReady(editor, { path: '/pages/' + route.page_id })
  await nav.goto(origin + '/sites/' + route.site_id)
  await nav.waitForLoadState('networkidle')
  const destinations = ['Pages', 'Stories', 'Media', 'Lists', 'Header & menu', 'Footer', 'Site look', 'Publish']
  const positions = []
  for (const name of destinations) {
    const box = await nav
      .getByRole('navigation', { name: 'Sections of the CMS' })
      .getByRole('link', { name, exact: true })
      .boundingBox()
    if (!box) throw Error('Could not find visible navigation destination ' + name)
    positions.push([box.x + box.width / 2, box.y + box.height / 2])
  }

  let start
  let finishedSave
  let inFlight = 0
  let maxInFlight = 0
  const events = new Map()
  const wanted = request =>
    request.url().startsWith(origin + '/') &&
    (request.method() === 'POST' || request.headers().rsc === '1' || request.resourceType() === 'document')
  for (const page of [editor, nav]) {
    page.on('request', request => {
      if (start === undefined || !wanted(request)) return
      events.set(request, {
        beganMs: performance.now() - start,
        method: request.method(),
        rsc: request.headers().rsc === '1',
      })
      maxInFlight = Math.max(maxInFlight, ++inFlight)
    })
    page.on('response', response => {
      const event = events.get(response.request())
      if (!event) return
      event.status = response.status()
      event.traceId = response.headers()['x-cms-perf-request']
    })
    const complete = (request, failure) => {
      const event = events.get(request)
      if (!event) return
      inFlight--
      event.finishedMs = performance.now() - start
      if (failure) event.aborted = true
      if (request.url() === editUrl && request.method() === 'POST') finishedSave = event.finishedMs
    }
    page.on('requestfinished', request => complete(request, false))
    page.on('requestfailed', request => complete(request, true))
  }

  const frame = editor.frameLocator('iframe[title="Page canvas"]')
  await frame.locator('[data-cms-slot="heading"]').first().click()
  const heading = editor.locator('input[id$="-heading"], textarea[id$="-heading"]').first()
  const text = await heading.inputValue()
  const saveStarted = editor.waitForRequest(request => request.url() === editUrl && request.method() === 'POST')
  const saveResponse = editor.waitForResponse(
    response => response.url() === editUrl && response.request().method() === 'POST',
  )
  start = performance.now()
  await heading.fill(text + ' (performance fixture)')
  if (mode === 'checkpoint') await editor.getByRole('button', { name: 'Save draft', exact: true }).click()
  await saveStarted
  const clicks = []
  for (const [x, y] of positions) {
    clicks.push({ atMs: performance.now() - start, duringSave: finishedSave === undefined })
    await nav.mouse.click(x, y)
  }
  const response = await saveResponse.catch(() => null)
  if (response) await Promise.race([response.finished(), delay(2000)])
  const editorSaved = response
    ? await editor
        .locator('.saved-state')
        .filter({ hasText: 'All changes saved' })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(
          () => true,
          () => false,
        )
    : false
  // A prior 'networkidle' lifecycle event can still be set when RSC traffic
  // starts. Follow these requests to their own finish/abort events instead.
  const deadline = performance.now() + 30000
  while (inFlight > 0 && performance.now() < deadline) await delay(25)
  const uncompletedRequests = inFlight
  const db = new Client({ connectionString: t.url })
  await db.connect()
  let savedKind
  try {
    const result = await db.query(
      'SELECT v.kind FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
      [route.page_id],
    )
    savedKind = result.rows[0]?.kind
  } finally {
    await db.end()
  }
  const traces = new Map(
    readFileSync(traceFile, 'utf8')
      .trim()
      .split('\n')
      .map(line => {
        const entry = JSON.parse(line)
        return [entry.id, entry]
      }),
  )
  const requests = [...events.values()].map(event => ({ ...event, server: traces.get(event.traceId) ?? null }))
  writeFileSync(
    join(out, 'burst.json'),
    JSON.stringify(
      {
        mode,
        clicks,
        saveStatus: response?.status() ?? null,
        savedKind,
        editorSaved,
        uncompletedRequests,
        maxInFlight,
        requests,
      },
      null,
      2,
    ) + '\n',
    {
      mode: 0o600,
      flag: 'wx',
    },
  )
} finally {
  try {
    await browser?.close()
  } finally {
    await stop()
  }
}
