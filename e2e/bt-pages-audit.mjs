// Audit the latest page-specific retakes alongside the full offline runs.
// Each engine keeps its own pixel baseline; no cross-engine font comparison.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import assert from 'node:assert/strict'
import sharp from '../packages/importer/node_modules/sharp/dist/index.mjs'
const root = '.r8-progress/step-5/remaining',
  summary = []
const knownError = /^\$\((?:\.\.\.|'\.popup-with-move-anim')\)\.magnificPopup is not a function(?:\.|$)/
for (const engine of ['chromium', 'firefox', 'webkit']) {
  const folder = root + '/' + engine,
    names = await readdir(folder),
    reports = await Promise.all(
      names
        .filter(name => /^report(?:-.+)?\.json$/.test(name))
        .map(async name => ({
          name,
          time: (await stat(folder + '/' + name)).mtimeMs,
          value: JSON.parse(await readFile(folder + '/' + name, 'utf8')),
        })),
    ),
    latest = new Map()
  for (const report of reports.sort((a, b) => a.time - b.time)) {
    assert.equal(report.value.engine, engine)
    assert(
      report.value.errors.every(error => knownError.test(error.error)),
      'Only the original missing-plugin error is allowed.',
    )
    assert.equal(
      report.value.errors.filter(error => error.side === 'cms').length,
      report.value.errors.filter(error => error.side === 'reference').length,
    )
    for (const page of report.value.pages) latest.set(page.slug + ':' + page.width, page)
  }
  assert.equal(latest.size, 24, 'Every marketing page must have all three widths.')
  for (const page of latest.values()) {
    assert.deepEqual(page.cms, page.reference, 'Original roots and rounded geometry must match.')
    for (const side of ['reference', 'cms']) {
      const behavior = page.behavior[side]
      if (page.width === 390 && page.slug !== 'manifesto') assert.equal(behavior.menu, true)
      if (page.slug === 'hotel-information') {
        assert.equal(behavior.popup, true)
        assert.equal(behavior.faq, true)
      }
      if (page.slug === 'workshops') {
        assert.equal(behavior.search, true)
        assert.equal(behavior.filter, true)
        assert.equal(behavior.empty, true)
      }
      if (page.slug === 'manifesto') assert.equal(behavior.colorAnimation, true)
    }
  }
  const pairs = []
  for (const name of names.filter(name => name.includes('-reference-') && name.endsWith('.png'))) {
    const cms = name.replace('-reference-', '-cms-')
    assert(names.includes(cms))
    const a = await sharp(folder + '/' + name)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      b = await sharp(folder + '/' + cms)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    assert.equal(a.info.width, b.info.width, name + ' width')
    assert.equal(a.info.height, b.info.height, name + ' height')
    let changed = 0
    for (let i = 0; i < a.data.length; i += 3)
      if (
        Math.max(
          Math.abs(a.data[i] - b.data[i]),
          Math.abs(a.data[i + 1] - b.data[i + 1]),
          Math.abs(a.data[i + 2] - b.data[i + 2]),
        ) > 24
      )
        changed++
    pairs.push({ reference: name, cms, pixelsOver24: changed })
    assert.equal(changed, 0, name + ' has a visible pixel difference. Review it under the documented stopping rule.')
  }
  const noJs = JSON.parse(await readFile(folder + '/no-js-report.json', 'utf8'))
  assert.equal(noJs.length, 8)
  assert(noJs.every(page => page.serverRendered))
  assert.equal(noJs.find(page => page.slug === 'workshops').rows, 126)
  summary.push({ engine, comparisons: latest.size, pairs: pairs.length, noJs: noJs.length, pixelsOver24: 0 })
  await writeFile(
    folder + '/final-audit.json',
    JSON.stringify({ summary: summary.at(-1), pages: [...latest.values()], pairs }, null, 2),
  )
}
await writeFile(root + '/final-audit.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
