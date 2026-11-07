import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Keep the measured loader work from growing while the remaining targets are
// tackled. These include session work, but exclude previews, images and APIs.
const budgets = {
  Home: [8, 37],
  'All sites': [3, 12],
  'Site overview': [10, 50],
  Pages: [8, 40],
  Stories: [8, 35],
  'Story editor': [7, 33],
  Media: [5, 25],
  Lists: [8, 34],
  Header: [10, 45],
  Footer: [10, 45],
  'Site look': [12, 55],
  Publishing: [14, 85],
  People: [4, 16],
  Inbox: [6, 24],
  Editor: [19, 81],
}

const [directory] = process.argv.slice(2)
if (!directory) throw Error('Usage: node scripts/perf/check-loader-budgets.mjs RUN_DIRECTORY')
const { routes, runsPerRoute } = JSON.parse(readFileSync(join(directory, 'routes.json'), 'utf8'))
assert.equal(runsPerRoute, 5, 'Expected the complete warm route run.')
assert.deepEqual(Object.keys(routes).sort(), Object.keys(budgets).sort(), 'The route inventory changed.')
const traceEntries = readFileSync(join(directory, 'capture', 'requests.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(line => JSON.parse(line))
const traces = new Map(traceEntries.map(trace => [trace.id, trace]))
assert.equal(traces.size, traceEntries.length, 'Trace IDs must be unique.')
const observed = {}
const regressions = []
for (const [name, [maxTransactions, maxStatements]] of Object.entries(budgets)) {
  assert.equal(routes[name].runs.length, runsPerRoute, name)
  const routeTraces = routes[name].runs.map(run => {
    // The first document or Flight response is the destination. Any later
    // fallback reload or preview request is accounted for in journey totals.
    const request = run.requests.find(request => request.topLevel || request.rsc)
    const trace = traces.get(request?.traceId)
    assert(trace?.complete && trace.app === 'admin' && trace.method === 'GET', 'No complete route trace for ' + name)
    assert(Number.isInteger(trace.transactions) && Number.isInteger(trace.statements))
    return trace
  })
  const transactions = Math.max(...routeTraces.map(trace => trace.transactions))
  const statements = Math.max(...routeTraces.map(trace => trace.statements))
  observed[name] = { transactions, statements, maxTransactions, maxStatements }
  if (transactions > maxTransactions || statements > maxStatements) regressions.push(name)
}
console.log(JSON.stringify({ observed, regressions }, null, 2))
if (regressions.length) process.exitCode = 1
