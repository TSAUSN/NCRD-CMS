// The property the whole package is arranged around: the same input produces the
// same bytes.
//
// Proved on a synthetic catalogue rather than on V1, so it holds on a machine
// that has never seen the V1 checkout, and so the fixture can contain the shapes
// that would break determinism if anything here were careless — attributes
// written out of order, several definitions that must come back sorted, reasons
// that arrive in a different order than they are reported in.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { reportCsv, reportJson, reportSummary } from './report.ts'
import { runImport } from './run.ts'
import { digest } from './backup.ts'
import { IMPORTER_VERSION } from './version.ts'

/**
 * A catalogue shaped exactly like V1's generated files, with markup written for
 * this test.
 *
 * Nothing here is copied from the V1 catalogue: the point is the file *shape* —
 * an `export const` in front of a JSON literal — because that shape is what
 * `readV1Catalogue` reads and what the line index scans.
 */
function writeFixture(root: string): void {
  const sources = {
    'beta-v1': {
      html: '<section class="beta"><p class="beta__lede" data-block-id="lede" data-editable="text">x</p></section>',
      css: '.beta{padding:1rem}.beta__lede{margin:0}',
    },
    'alpha-v1': {
      html: '<div id="a" class="alpha" role="note"><button>go</button></div>',
      css: '.alpha{color:#111}',
    },
    'gamma-v1': {
      html: '<section class="gamma"><span class="fx-lift" data-block-id="t" data-editable="text">y</span></section>',
      css: '.gamma{padding:2rem}',
    },
  }
  const registry = [
    {
      source: 'git',
      id: 'beta-v1',
      name: 'Beta',
      category: 'Content',
      family: 'beta',
      version: 1,
      slots: [{ blockId: 'lede', editable: 'text', label: 'Lede' }],
    },
    {
      source: 'git',
      id: 'alpha-v1',
      name: 'Alpha',
      category: 'Chrome',
      family: 'alpha',
      version: 1,
      sites: ['one'],
      slots: [],
    },
    {
      source: 'git',
      id: 'gamma-v1',
      name: 'Gamma',
      category: 'Content',
      family: 'gamma',
      version: 1,
      slots: [{ blockId: 't', editable: 'text', label: 'Text' }],
    },
  ]
  const presets = 'export const INTERACTION_PRESET_CSS = `\n.fx-lift:hover{transform:translateY(-2px)}\n`\n'

  const admin = path.join(root, 'v1', 'tsa-cms-admin', 'src', 'sections')
  const hni = path.join(root, 'v1', 'tsa-humanneedsindex', 'src', 'cms')
  const census = path.join(root, 'repo', 'docs', 'v1-inventory')
  for (const dir of [admin, hni, census]) mkdirSync(dir, { recursive: true })

  writeFileSync(
    path.join(admin, 'registrySource.generated.js'),
    `export const gitTemplateSources = ${JSON.stringify(sources, null, 2)}\n`,
  )
  writeFileSync(
    path.join(admin, 'registry.generated.js'),
    `export const gitSectionTemplates = ${JSON.stringify(registry, null, 2)}\n`,
  )
  writeFileSync(path.join(hni, 'interaction-presets.js'), presets)
  writeFileSync(
    path.join(hni, 'section-templates.js'),
    `const gamma = ${JSON.stringify({ ...registry[2], ...sources['gamma-v1'] })}; export const gitSectionTemplates = [gamma]`,
  )
  writeFileSync(
    path.join(hni, 'library-sections.js'),
    `export const librarySectionTemplates = [${JSON.stringify({ ...registry[0], ...sources['beta-v1'] })}]`,
  )
  writeFileSync(
    path.join(census, 'summary.json'),
    `${JSON.stringify(
      {
        divergence: {
          htmlDivergesAcrossSites: [
            {
              id: 'gamma-v1',
              sites: ['humanneedsindex'],
              hashes: { humanneedsindex: digest(sources['gamma-v1'].html).slice(0, 16) },
            },
          ],
        },
        crossSectionAnchors: { unresolved: [{ from: 'alpha-v1', anchor: 'top' }] },
      },
      null,
      2,
    )}\n`,
  )
}

const root = mkdtempSync(path.join(tmpdir(), 'cms-importer-'))
writeFixture(root)
const options = { v1Root: path.join(root, 'v1'), repoRoot: path.join(root, 'repo') }

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('running the importer twice over the same input', () => {
  const first = runImport(options)
  const second = runImport(options)

  it('produces byte-identical JSON', () => {
    expect(reportJson(second)).toBe(reportJson(first))
  })

  it('produces byte-identical CSV', () => {
    expect(reportCsv(second)).toBe(reportCsv(first))
  })

  it('produces a byte-identical human summary', () => {
    expect(reportSummary(second)).toBe(reportSummary(first))
  })

  it('gives both runs the same run ID, because the inputs are the same', () => {
    expect(second.runId).toBe(first.runId)
  })

  it('writes no timestamp into any of the three reports', () => {
    const everything = reportJson(first) + reportCsv(first) + reportSummary(first)
    // A four-digit year, an ISO instant, or an epoch in milliseconds. Any of the
    // three would make two runs differ without either input having changed.
    expect(everything).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(everything).not.toMatch(/\b1[6-9]\d{11}\b/)
  })

  it('writes no absolute path into any of the three reports', () => {
    const everything = reportJson(first) + reportCsv(first) + reportSummary(first)
    expect(everything).not.toContain(root)
    expect(everything).not.toContain('/Users/')
  })
})

describe('the run ID', () => {
  it('changes when an input changes, so two runs can never be confused', () => {
    const before = runImport(options).runId
    writeFileSync(
      path.join(root, 'v1', 'tsa-humanneedsindex', 'src', 'cms', 'interaction-presets.js'),
      'export const INTERACTION_PRESET_CSS = `\n.fx-lift:hover{transform:none}\n`\n',
    )
    const after = runImport(options)
    expect(after.runId).not.toBe(before)
    writeFixture(root)
    expect(runImport(options).runId).toBe(before)
  })

  it('is derived from the manifest and this importer’s version, and says which', () => {
    const run = runImport(options)
    expect(run.importerVersion).toBe(IMPORTER_VERSION)
    expect(run.runId).toHaveLength(32)
    expect(run.manifest.sha256).toHaveLength(64)
  })

  it('names every file it read, relative to a root and never absolutely', () => {
    const run = runImport(options)
    expect(run.manifest.files.map(file => file.path)).toEqual([
      'docs/v1-inventory/summary.json',
      'tsa-cms-admin/src/sections/registry.generated.js',
      'tsa-cms-admin/src/sections/registrySource.generated.js',
      'tsa-humanneedsindex/src/cms/interaction-presets.js',
      'tsa-humanneedsindex/src/cms/library-sections.js',
      'tsa-humanneedsindex/src/cms/section-templates.js',
    ])
  })
})

describe('the order everything comes back in', () => {
  const run = runImport(options)

  it('sorts definitions by id rather than inheriting the registry’s order', () => {
    expect(run.records.map(record => record.provenance.id)).toEqual(['alpha-v1', 'beta-v1', 'gamma-v1'])
  })

  it('gives each definition the line its entry starts on in the file it was read from', () => {
    const alpha = run.records.find(record => record.provenance.id === 'alpha-v1')!
    expect(alpha.provenance.sourceFile).toBe('tsa-cms-admin/src/sections/registrySource.generated.js')
    // Second entry in the fixture, which the generator writes after the first.
    expect(alpha.provenance.sourceLine).toBeGreaterThan(1)
  })

  it('records a hash of the markup it read and never the markup', () => {
    for (const record of run.records) {
      expect(record.provenance.htmlSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(record.provenance.cssSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('the statuses this fixture is built to produce', () => {
  const run = runImport(options)
  const statusOf = (id: string) => run.records.find(record => record.provenance.id === id)!.status

  it('converts the definition every part of which has somewhere to go', () => {
    expect(statusOf('beta-v1')).toBe('automatic')
  })

  it('quarantines the one holding a button, over the pending anchor decision it also has', () => {
    const alpha = run.records.find(record => record.provenance.id === 'alpha-v1')!
    expect(alpha.status).toBe('quarantined')
    expect(alpha.reasons.map(reason => reason.code)).toContain('unresolved-anchor')
  })

  it('carries the source preset styling with an independent destination variant and no default canonical import', () => {
    const gamma = run.records.find(record => record.provenance.id === 'gamma-v1')!
    expect(statusOf('gamma-v1')).toBe('manual-decision')
    expect(gamma.reasons.map(reason => reason.code)).toEqual(['site-divergence'])
    expect(gamma.conversion.measurements.borrowedClasses).toEqual(['fx-lift'])
    expect(gamma.variants).toHaveLength(1)
    expect(gamma.variants[0]!.status).toBe('automatic')
    expect(gamma.variants[0]!.sourceSite).toBe('humanneedsindex')
    expect(run.counts.siteVariants).toEqual({
      definitions: 1,
      variants: 1,
      byStatus: { automatic: 1, quarantined: 0, 'manual-decision': 0 },
    })
  })
})
