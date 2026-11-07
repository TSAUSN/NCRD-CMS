import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import { applications, fixture, localCookie, privateDirectory, root, target } from '../golden/local.mjs'
import { adminRoutes } from '../golden/admin-routes.mjs'
import { adminReady } from '../golden/admin-ready.mjs'

const { chromium } = createRequire(join(root, 'e2e/package.json'))('@playwright/test')
const args = process.argv.slice(2)
function option(name) {
  if (!args.includes(name) || !args[args.indexOf(name) + 1]) throw Error('Supply ' + name)
  return args[args.indexOf(name) + 1]
}

const routes = [
  ['Home', '/'],
  ['All sites', '/sites'],
  ['Site overview', '/sites/[siteId]'],
  ['Pages', '/sites/[siteId]/pages'],
  ['Stories', '/sites/[siteId]/stories'],
  ['Story editor', '/sites/[siteId]/stories/[entryId]'],
  ['Media', '/sites/[siteId]/media'],
  ['Lists', '/sites/[siteId]/content'],
  ['Header', '/sites/[siteId]/header'],
  ['Footer', '/sites/[siteId]/footer'],
  ['Site look', '/sites/[siteId]/design'],
  ['Publishing', '/sites/[siteId]/publishing'],
  ['People', '/people'],
  ['Inbox', '/inbox'],
  ['Editor', '/pages/[pageId]'],
]

function captureRequests(page) {
  const records = new Map()
  const pending = []
  const onRequest = request => {
    const headers = request.headers()
    const path = new URL(request.url()).pathname
    let topLevel = false
    if (request.resourceType() === 'document') {
      try {
        topLevel = request.frame() === page.mainFrame()
      } catch {}
    }
    records.set(request, {
      type: request.resourceType(),
      topLevel,
      method: request.method(),
      rsc: headers.rsc === '1',
      action: Boolean(headers['next-action']),
      siteChoices: path === '/api/sites',
      inboxSummary: path === '/api/inbox/summary',
    })
  }
  const onResponse = response => {
    const request = response.request()
    const entry = records.get(request)
    if (!entry) return
    const headers = response.headers()
    entry.status = response.status()
    entry.traceId = headers['x-cms-perf-request']
    pending.push(
      (async () => {
        try {
          await response.finished()
          const sizes = await request.sizes()
          entry.bytes = sizes.responseBodySize
          if (entry.type === 'script' || entry.type === 'stylesheet')
            entry.gzipBytes = gzipSync(await response.body()).length
        } catch {
          entry.incomplete = true
        }
      })(),
    )
  }
  const onFailure = request => {
    const entry = records.get(request)
    if (entry) entry.incomplete = true
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onFailure)
  return async () => {
    page.off('request', onRequest)
    page.off('response', onResponse)
    page.off('requestfailed', onFailure)
    await Promise.race([Promise.all(pending), delay(3000, undefined, { ref: false })])
    return [...records.values()].map(entry => ({
      ...entry,
      incomplete:
        entry.incomplete ||
        entry.bytes === undefined ||
        ((entry.type === 'script' || entry.type === 'stylesheet') && entry.gzipBytes === undefined),
    }))
  }
}

async function runRoute(page, origin, route) {
  const end = captureRequests(page)
  const url = origin + route.path
  const href = page.locator('a[href=' + JSON.stringify(route.path) + ']:visible').first()
  const start = performance.now()
  const mode = !args.includes('--document') && page.url() !== url && (await href.count()) ? 'link' : 'document'
  if (mode === 'link') await Promise.all([page.waitForURL(url), href.click()])
  else await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page
    .locator(route.name === 'Editor' ? '.editor' : 'main:not([aria-busy="true"]) h1')
    .first()
    .waitFor({ state: 'visible' })
  const controlsMs = performance.now() - start
  await adminReady(page, route)
  const readyMs = performance.now() - start
  // Readiness above checks the actual controls and canvas. Some editor
  // background requests can continue after it becomes usable.
  const quiet = await page.waitForLoadState('networkidle', { timeout: 2500 }).then(
    () => true,
    () => false,
  )
  return { mode, controlsMs, readyMs, quiet, requests: await end() }
}

function summarize(sample, traces) {
  const { requests } = sample
  const trace = requests.map(r => traces.get(r.traceId)).filter(Boolean)
  const total = key => trace.reduce((sum, row) => sum + row[key], 0)
  const sumBytes = (filter, key) => requests.filter(filter).reduce((sum, row) => sum + (row[key] ?? 0), 0)
  return {
    controlsMs: sample.controlsMs,
    readyMs: sample.readyMs,
    documents: requests.filter(r => r.topLevel).length,
    frameDocuments: requests.filter(r => r.type === 'document' && !r.topLevel).length,
    rsc: requests.filter(r => r.rsc).length,
    siteChoiceRequests: requests.filter(r => r.siteChoices).length,
    inboxSummaryRequests: requests.filter(r => r.inboxSummary).length,
    transactions: total('transactions'),
    statements: total('statements'),
    connectionWaitMs: total('connectionWaitMs'),
    queryMs: total('queryMs'),
    renderMs: total('renderMs'),
    authChecks: total('authChecks'),
    outboundAuthCalls: total('outboundAuthCalls'),
    payloadBytes: sumBytes(() => true, 'bytes'),
    imageRequests: requests.filter(r => r.type === 'image').length,
    scriptGzipBytes: sumBytes(r => r.type === 'script', 'gzipBytes'),
    cssGzipBytes: sumBytes(r => r.type === 'stylesheet', 'gzipBytes'),
    incompleteRequests: requests.filter(r => r.incomplete).length,
  }
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function main() {
  const t = target()
  if (t.database !== 'cms_e2e_refactor_perf') throw Error('Measure only on the separate local perf fixture.')
  const out = privateDirectory(option('--out'))
  const resultFile = resolve(option('--result'))
  privateDirectory(dirname(resultFile))
  const fixtureData = await fixture(t)
  const catalog = await adminRoutes(t, fixtureData)
  const selected = routes.map(([name, pattern]) => {
    const row = catalog.cases.find(route => route.pattern === pattern)
    if (!row) throw Error('Missing performance route ' + pattern)
    return { ...row, name }
  })
  const overview = selected.find(route => route.name === 'Site overview')
  const origin = 'http://127.0.0.1:' + t.ports.admin
  const traceFile = join(out, 'requests.jsonl')
  writeFileSync(traceFile, '', { mode: 0o600, flag: 'wx' })
  const stop = await applications(t, out, option('--media-root'), { traceFile })
  let browser
  const samples = Object.fromEntries(selected.map(route => [route.name, []]))
  try {
    browser = await chromium.launch({ headless: true })
    for (let trial = 0; trial <= 5; trial++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
      await context.addCookies([
        {
          name: 'cms_session',
          value: localCookie(fixtureData.owner.email).slice('cms_session='.length),
          domain: '127.0.0.1',
          path: '/',
        },
      ])
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
          ? route.continue()
          : route.abort()
      })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      for (const route of selected) {
        try {
          if (route.name === 'Editor' && !args.includes('--document')) {
            // Measure the actual edit link. The inbox does not always contain a
            // link to this page; the fixture's site overview does.
            await page.goto(origin + overview.path, { waitUntil: 'networkidle' })
          }
          console.log('Trial ' + trial + ': ' + route.name)
          const sample = await runRoute(page, origin, route)
          if (trial) samples[route.name].push(sample)
        } catch (error) {
          throw Error('Trial ' + trial + ', ' + route.name + ': ' + error.message, { cause: error })
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
  const traces = new Map(
    readFileSync(traceFile, 'utf8')
      .trim()
      .split('\n')
      .map(line => {
        const row = JSON.parse(line)
        return [row.id, row]
      }),
  )
  const result = {}
  for (const [name, runs] of Object.entries(samples)) {
    const values = runs.map(run => summarize(run, traces))
    if (!values.every(run => run.transactions > 0)) throw Error('No database trace for at least one sample of ' + name)
    result[name] = {
      median: Object.fromEntries(Object.keys(values[0]).map(key => [key, median(values.map(v => v[key]))])),
      runs,
    }
  }
  writeFileSync(resultFile, JSON.stringify({ runsPerRoute: 5, poolMax: 2, routes: result }, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  })
}

main().catch(error => {
  console.error(
    String(error.message)
      .split('\n')[0]
      .replace(/https?:\/\/\S+/g, '[private URL omitted]'),
  )
  process.exitCode = 1
})
