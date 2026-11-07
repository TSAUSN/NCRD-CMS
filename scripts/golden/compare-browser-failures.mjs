import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function outcome(test) {
  if (!test.results.length || test.results.every(result => result.status === 'interrupted')) return 'notRun'
  if (test.status === 'unexpected' || test.status === 'flaky') return 'failed'
  if (test.status === 'skipped') return 'skipped'
  return 'expected'
}

function collect(report) {
  if (!report.stats || !Array.isArray(report.suites) || report.errors?.length)
    throw Error('Playwright did not produce a complete suite report.')
  const titles = new Map()
  function visit(suite, parents) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const title = JSON.stringify([test.projectName, ...parents, spec.title])
        const counts = titles.get(title) ?? { expected: 0, failed: 0, skipped: 0, notRun: 0 }
        counts[outcome(test)]++
        titles.set(title, counts)
      }
    for (const child of suite.suites ?? []) visit(child, [...parents, child.title])
  }
  for (const file of report.suites) visit(file, [])
  if (!titles.size) throw Error('Playwright reported no test titles.')
  return titles
}

/** Filenames can move, but each project, describe path and title survives. */
export function compareBrowserReports(baseline, candidate) {
  const previous = collect(baseline)
  const next = collect(candidate)
  const total = counts => Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0)
  const regressions = []
  for (const [title, before] of previous) {
    if (total(next.get(title)) < total(before)) regressions.push({ title: JSON.parse(title), reason: 'missing test' })
  }
  for (const [title, after] of next) {
    const before = previous.get(title)
    for (const [key, reason] of [
      ['failed', 'new failure'],
      ['skipped', 'new skip'],
      ['notRun', 'new test not run'],
    ]) {
      if (after[key] > (before?.[key] ?? 0)) regressions.push({ title: JSON.parse(title), reason })
    }
  }
  return { before: baseline.stats, after: candidate.stats, regressions }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [before, after] = process.argv.slice(2)
  if (!before || !after) throw Error('Usage: node scripts/golden/compare-browser-failures.mjs before.json after.json')
  const comparison = compareBrowserReports(...[before, after].map(path => JSON.parse(readFileSync(path, 'utf8'))))
  console.log(JSON.stringify(comparison, null, 2))
  if (comparison.regressions.length) process.exitCode = 1
}
