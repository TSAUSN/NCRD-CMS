import { describe, expect, it } from 'vitest'
import { reportCsv, reportJson, reportSummary } from './report.ts'
import { orderReasons, reason, statusFor, IMPORT_STATUSES } from './reasons.ts'
import type { ImportRecord, ImportRun } from './run.ts'

function record(id: string, reasons: ReturnType<typeof reason>[], converted = false): ImportRecord {
  const ordered = orderReasons(reasons)
  return {
    variants: [],
    provenance: {
      id,
      sourceFile: 'tsa-cms-admin/src/sections/registrySource.generated.js',
      sourceLine: 12,
      htmlSha256: 'a'.repeat(64),
      cssSha256: 'b'.repeat(64),
    },
    category: 'Content',
    family: 'quote',
    scope: 'shared',
    sites: [],
    slotCount: 2,
    status: statusFor(ordered),
    reasons: ordered,
    conversion: {
      id,
      status: statusFor(ordered),
      reasons: ordered,
      document: converted ? { schemaVersion: 1, fields: [{ name: 'a', type: 'text', label: 'A' }], nodes: [] } : null,
      compiledCss: converted ? '.cms-section--x{color:#111}' : null,
      renderHash: converted ? 'c'.repeat(32) : null,
      measurements: { nodes: 3, fields: 1, depth: 2, borrowedClasses: [] },
    },
  }
}

function run(records: ImportRecord[]): ImportRun {
  return {
    importerVersion: 1,
    runId: 'd'.repeat(32),
    manifest: {
      files: [{ path: 'docs/v1-inventory/summary.json', sha256: 'e'.repeat(64), bytes: 10, lines: 2 }],
      sha256: 'f'.repeat(64),
    },
    records,
    counts: {
      definitions: records.length,
      siteVariants: { definitions: 0, variants: 0, byStatus: { automatic: 0, quarantined: 0, 'manual-decision': 0 } },
      byStatus: Object.fromEntries(
        IMPORT_STATUSES.map(status => [status, records.filter(r => r.status === status).length]),
      ) as ImportRun['counts']['byStatus'],
      byReason: [],
      soleReason: [],
    },
  }
}

describe('the JSON report', () => {
  const only = run([record('icon-card-grid-v1', [reason('icon-field')])])

  it('parses, so anything downstream can read it without a repair step', () => {
    expect(() => JSON.parse(reportJson(only))).not.toThrow()
  })

  it('states that automatic conversion is not evidence of visual or runtime parity', () => {
    const assessment = JSON.parse(reportJson(only)).assessmentScope
    expect(assessment).toContain('Automatic does not establish visual parity')
    expect(assessment).toContain('saved-instance fidelity or JavaScript behavior')
    expect(reportSummary(only)).toContain('Automatic does not establish visual parity')
  })

  it('ends with a newline, the way a file a person opens should', () => {
    expect(reportJson(only).endsWith('}\n')).toBe(true)
  })

  it('gives every reason both a code and a sentence', () => {
    const [definition] = JSON.parse(reportJson(only)).definitions
    expect(definition.reasons[0].code).toBe('icon-field')
    expect(definition.reasons[0].disposition).toBe('quarantine')
    expect(definition.reasons[0].sentence).toMatch(/^It has an icon slot/)
  })

  it('records provenance as a path, a line and two hashes, and nothing else', () => {
    const [definition] = JSON.parse(reportJson(only)).definitions
    expect(Object.keys(definition.provenance).sort()).toEqual(['cssSha256', 'htmlSha256', 'sourceFile', 'sourceLine'])
  })

  it('leaves the structured block null for anything that was not converted', () => {
    const [definition] = JSON.parse(reportJson(only)).definitions
    expect(definition.structured).toBeNull()
    expect(definition.renderHash).toBeNull()
  })

  it('summarises a converted document by shape and field type, never by field name', () => {
    const converted = run([record('quote-v1', [], true)])
    const [definition] = JSON.parse(reportJson(converted)).definitions
    expect(definition.structured).toEqual({
      schemaVersion: 1,
      nodes: 3,
      fields: 1,
      depth: 2,
      fieldTypes: { text: 1 },
    })
    expect(reportJson(converted)).not.toContain('"a"')
  })
})

describe('the CSV report', () => {
  const two = run([record('a-v1', [reason('icon-field')]), record('b-v1', [], true)])

  it('has a header and one row per definition', () => {
    const lines = reportCsv(two).trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(
      'id,status,category,family,scope,slots,source_file,source_line,html_sha256,css_sha256,' +
        'render_hash,nodes,fields,depth,reason_codes,reason_details,site_variant_receipts',
    )
  })

  it('quotes every cell, so a reason detail containing a comma cannot add a column', () => {
    const withComma = run([record('a-v1', [reason('unsupported-attribute', 'class, id')])])
    const [, row] = reportCsv(withComma).trimEnd().split('\n')
    expect(row!.split('","')).toHaveLength(17)
  })

  it('keeps independently hashed variant receipts in one CSV cell without adding parent rows or licensed source', () => {
    const parent = record('sample-v1', [reason('site-divergence')])
    const child = record('sample-v1', [], true)
    parent.variants = [
      {
        sourceSite: 'humanneedsindex',
        provenance: child.provenance,
        parity: { status: 'pass', substantiveDifferences: 0 },
        slotCount: 2,
        status: child.status,
        reasons: [],
        conversion: child.conversion,
      },
    ]
    const csv = reportCsv(run([parent]))
      .trimEnd()
      .split('\n')
    expect(csv).toHaveLength(2)
    // Decode the RFC4180 quoted cells, including doubled quotes inside JSON.
    const cells = [...csv[1]!.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1]!.replaceAll('""', '"'))
    expect(cells).toHaveLength(17)
    expect(JSON.parse(cells[16]!)).toEqual([
      {
        sourceSite: 'humanneedsindex',
        status: 'automatic',
        parity: { status: 'pass', substantiveDifferences: 0 },
        provenance: child.provenance,
        renderHash: child.conversion.renderHash,
        reasons: [],
      },
    ])
    expect(csv[1]).not.toContain('structured_doc')
  })

  it('doubles a quote rather than ending the cell on it', () => {
    const withQuote = run([record('a-v1', [reason('unsupported-attribute', 'a"b')])])
    expect(reportCsv(withQuote)).toContain('a""b')
  })
})

describe('the human summary', () => {
  const two = run([record('a-v1', [reason('icon-field')]), record('b-v1', [], true)])
  const text = reportSummary(two)

  it('leads with the run and the files it was derived from', () => {
    expect(text).toContain('d'.repeat(32))
    expect(text).toContain('docs/v1-inventory/summary.json')
  })

  it('gives a count and a share for each of the three statuses', () => {
    expect(text).toMatch(/automatic\s+1\s+50\.0%/)
    expect(text).toMatch(/quarantined\s+1\s+50\.0%/)
    expect(text).toMatch(/manual-decision\s+0\s+0\.0%/)
  })

  it('lists every definition with its status, including the ones that converted', () => {
    expect(text).toMatch(/a-v1\s+quarantined\s+icon-field/)
    expect(text).toMatch(/b-v1\s+automatic/)
  })

  it('explains only the reason codes this run actually produced', () => {
    expect(text).toContain('icon-field')
    expect(text).not.toContain('form-element')
  })
})

describe('the reason vocabulary', () => {
  it('refuses a code nobody declared, rather than inventing a sentence for it', () => {
    expect(() => reason('made-up')).toThrow(/not a reason this importer knows/)
  })

  it('calls a definition automatic only when it has no reasons at all', () => {
    expect(statusFor([])).toBe('automatic')
  })

  it('lets a hard blocker outrank a pending decision, because settling it changes nothing', () => {
    expect(statusFor([reason('site-divergence'), reason('icon-field')])).toBe('quarantined')
    expect(statusFor([reason('site-divergence')])).toBe('manual-decision')
  })

  it('collapses a repeated reason and orders the rest by the vocabulary, not by arrival', () => {
    expect(
      orderReasons([reason('css-rejected'), reason('icon-field'), reason('icon-field'), reason('button-element')]).map(
        item => item.code,
      ),
    ).toEqual(['icon-field', 'button-element', 'css-rejected'])
  })

  it('keeps two reasons apart when they share a code and differ in detail', () => {
    expect(
      orderReasons([reason('unsupported-element', 'nav'), reason('unsupported-element', 'a')]).map(item => item.detail),
    ).toEqual(['a', 'nav'])
  })
})
