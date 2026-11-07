import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareBrowserReports } from './compare-browser-failures.mjs'

const result = (title, status, projectName = 'webkit') => ({
  title,
  tests: [{ status, projectName, results: status === 'not-run' ? [] : [{ status: 'passed' }] }],
})
const report = (file, specs) => ({
  stats: {},
  errors: [],
  suites: [{ title: file, suites: [{ title: 'editor', specs }] }],
})

test('permits moved files and fewer failures while rejecting a different failure', () => {
  const before = report('old.spec.ts', [result('save', 'unexpected'), result('publish', 'expected')])
  assert.deepEqual(
    compareBrowserReports(before, report('new.spec.ts', [result('save', 'expected'), result('publish', 'expected')]))
      .regressions,
    [],
  )
  assert.deepEqual(
    compareBrowserReports(before, report('new.spec.ts', [result('save', 'expected'), result('publish', 'unexpected')]))
      .regressions,
    [{ title: ['webkit', 'editor', 'publish'], reason: 'new failure' }],
  )
})

test('rejects missing duplicate titles and new skips or unattempted tests', () => {
  const before = report('old.spec.ts', [
    result('save', 'expected'),
    result('save', 'expected'),
    result('publish', 'expected'),
  ])
  const after = report('new.spec.ts', [result('save', 'skipped'), result('publish', 'not-run')])
  assert.deepEqual(
    compareBrowserReports(before, after).regressions.map(row => row.reason),
    ['missing test', 'new skip', 'new test not run'],
  )
})
