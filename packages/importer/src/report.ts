// A run, as bytes.
//
// Three renderings of the same run — JSON for a program, CSV for a spreadsheet,
// and prose for a person — and one rule that governs all three: **no V1 markup,
// no V1 CSS, no V1 copy**. The catalogue is licensed source this repository is
// not allowed to carry, so provenance here is a definition id, a file path, a
// line, and a content hash. Everything else is a count, a status, or a reason
// code from this package's own vocabulary.
//
// That rule is why several fields look coarser than they could be. A refusal
// over an attribute names the attribute and not its value; a refusal over slots
// gives a number and not the slot ids; a refusal from the CSS policy is reduced
// to a token before it gets here, because the policy quotes the stylesheet it
// rejected. The importer knows more than it writes down, on purpose.
//
// The other rule is byte-stability. Every list is sorted before it is rendered,
// every number is an integer, and nothing here reads a clock. Two runs over the
// same inputs produce the same bytes, and `determinism.test.ts` is what says so.

import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import type { ImportRecord, ImportRun, SiteVariantRecord } from './run.ts'
import { REASON_ORDER } from './reasons.ts'

const ASSESSMENT_SCOPE =
  'Definition conversion with default content and source-owned scriptless preset CSS. ' +
  'Automatic does not establish visual parity, saved-instance fidelity or JavaScript behavior.'

/**
 * The machine-readable report.
 *
 * `JSON.stringify` with two-space indentation, which is stable for a given
 * object because key order is insertion order and every object below is built by
 * a literal. The literal is the schema.
 */
export function reportJson(run: ImportRun): string {
  return `${JSON.stringify(
    {
      importerVersion: run.importerVersion,
      runId: run.runId,
      assessmentScope: ASSESSMENT_SCOPE,
      sourceManifest: run.manifest,
      counts: run.counts,
      definitions: run.records.map(record => ({
        id: record.provenance.id,
        status: record.status,
        category: record.category,
        family: record.family,
        scope: record.scope,
        sites: record.sites,
        slots: record.slotCount,
        provenance: {
          sourceFile: record.provenance.sourceFile,
          sourceLine: record.provenance.sourceLine,
          htmlSha256: record.provenance.htmlSha256,
          cssSha256: record.provenance.cssSha256,
        },
        // Present only for a definition that converted. A render hash for a
        // document nobody produced would be a hash of an empty document, and it
        // would look exactly like a successful import in a diff.
        renderHash: record.conversion.renderHash,
        structured:
          record.conversion.document === null
            ? null
            : {
                schemaVersion: record.conversion.document.schemaVersion,
                nodes: record.conversion.measurements.nodes,
                fields: record.conversion.measurements.fields,
                depth: record.conversion.measurements.depth,
                // Field *types*, not names: a field name is V1's naming of V1's content.
                fieldTypes: countTypes(record),
              },
        variants: record.variants.map(variant => ({
          sourceSite: variant.sourceSite,
          status: variant.status,
          parity: variant.parity,
          provenance: variant.provenance,
          slots: variant.slotCount,
          renderHash: variant.conversion.renderHash,
          structured:
            variant.conversion.document === null
              ? null
              : {
                  schemaVersion: variant.conversion.document.schemaVersion,
                  nodes: variant.conversion.measurements.nodes,
                  fields: variant.conversion.measurements.fields,
                  fieldTypes: countTypes(variant),
                },
          reasons: variant.reasons,
        })),
        reasons: record.reasons.map(reason => ({
          code: reason.code,
          disposition: reason.disposition,
          detail: reason.detail ?? null,
          sentence: reason.sentence,
        })),
      })),
    },
    null,
    2,
  )}\n`
}

function countTypes(record: ImportRecord | SiteVariantRecord): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const field of record.conversion.document?.fields ?? []) {
    counts[field.type] = (counts[field.type] ?? 0) + 1
  }
  // Rebuilt in a fixed key order, because the object above is keyed by whichever
  // type the definition declared first.
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map(key => [key, counts[key]!]),
  )
}

/** RFC 4180 quoting: always quoted, inner quotes doubled. */
function csvCell(value: string | number): string {
  return `"${String(value).split('"').join('""')}"`
}

const CSV_COLUMNS = [
  'id',
  'status',
  'category',
  'family',
  'scope',
  'slots',
  'source_file',
  'source_line',
  'html_sha256',
  'css_sha256',
  'render_hash',
  'nodes',
  'fields',
  'depth',
  'reason_codes',
  'reason_details',
  'site_variant_receipts',
] as const

export function reportCsv(run: ImportRun): string {
  const rows = [CSV_COLUMNS.join(',')]
  for (const record of run.records) {
    rows.push(
      [
        record.provenance.id,
        record.status,
        record.category,
        record.family ?? '',
        record.scope,
        record.slotCount,
        record.provenance.sourceFile,
        record.provenance.sourceLine,
        record.provenance.htmlSha256,
        record.provenance.cssSha256,
        record.conversion.renderHash ?? '',
        record.conversion.measurements.nodes,
        record.conversion.measurements.fields,
        record.conversion.measurements.depth,
        record.reasons.map(reason => reason.code).join(' '),
        // Space-joined inside one cell rather than one column per reason: the
        // number of reasons a definition has is not fixed, and a CSV whose column
        // count depends on its contents is not a CSV anybody can open twice.
        record.reasons.map(reason => `${reason.code}=${reason.detail ?? ''}`).join('; '),
        JSON.stringify(
          record.variants.map(variant => ({
            sourceSite: variant.sourceSite,
            status: variant.status,
            parity: variant.parity,
            provenance: variant.provenance,
            renderHash: variant.conversion.renderHash,
            reasons: variant.reasons.map(reason => reason.code),
          })),
        ),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${rows.join('\n')}\n`
}

/**
 * The human summary.
 *
 * Written to be read top to bottom by somebody deciding what to build next, so
 * it leads with the three counts, then with what each refusal costs, and only
 * then with the per-definition detail. The `sole obstacle` table is the one that
 * answers a planning question: it is how many definitions one specific piece of
 * work would unblock, as opposed to how many mention a code somewhere.
 */
export function reportSummary(run: ImportRun): string {
  const lines: string[] = []
  const total = run.counts.definitions

  // The version is read from the schema rather than written out, because the
  // mapping targets whatever the schema currently is and a literal here is a
  // line that goes stale the next time the model grows.
  lines.push(`V1 catalogue → structured schema v${STRUCTURED_SCHEMA_VERSION}`)
  lines.push('')
  for (const line of wrap(ASSESSMENT_SCOPE, 78)) lines.push(line)
  lines.push('')
  lines.push(`run           ${run.runId}`)
  lines.push(`importer      version ${run.importerVersion}`)
  lines.push(`inputs        ${run.manifest.files.length} files, manifest ${run.manifest.sha256.slice(0, 16)}`)
  for (const file of run.manifest.files) {
    lines.push(`              ${file.sha256.slice(0, 12)}  ${String(file.bytes).padStart(8)}  ${file.path}`)
  }
  lines.push('')
  lines.push(`definitions   ${total}`)
  for (const status of ['automatic', 'quarantined', 'manual-decision'] as const) {
    const count = run.counts.byStatus[status]
    lines.push(`  ${status.padEnd(16)}${String(count).padStart(4)}   ${percent(count, total)}`)
  }
  lines.push('')
  lines.push('why, by reason code — a definition can have several')
  lines.push(
    '',
    `Separate source-site variants: ${run.counts.siteVariants.variants} subreceipts for ${run.counts.siteVariants.definitions} of the ${total} parent definitions.`,
    `Variant conversion: ${Object.entries(run.counts.siteVariants.byStatus)
      .map(([status, count]) => `${status} ${count}`)
      .join('; ')}.`,
    'Divergent parent rows remain in the legacy manual-decision/quarantine counts; no canonical-site choice is pending. Use the destination variant receipt. These counts do not establish visual fidelity.',
    '',
  )
  for (const row of run.counts.byReason) {
    lines.push(`  ${row.code.padEnd(24)}${String(row.definitions).padStart(4)}`)
  }
  lines.push('')
  lines.push('definitions whose only obstacle is this one code')
  if (run.counts.soleReason.length === 0) lines.push('  (none)')
  for (const row of run.counts.soleReason) {
    lines.push(`  ${row.code.padEnd(24)}${String(row.definitions).padStart(4)}`)
  }
  lines.push('')
  lines.push('what each reason means')
  const seen = new Set(run.records.flatMap(record => record.reasons.map(reason => reason.code)))
  for (const code of REASON_ORDER) {
    if (!seen.has(code)) continue
    const example = run.records.flatMap(record => record.reasons).find(reason => reason.code === code)!
    lines.push(`  ${code}`)
    for (const line of wrap(example.sentence, 74)) lines.push(`    ${line}`)
  }
  lines.push('')
  lines.push('converted')
  const converted = run.records.filter(record => record.status === 'automatic')
  if (converted.length === 0) lines.push('  (none)')
  for (const record of converted) {
    lines.push(
      `  ${record.provenance.id.padEnd(32)}` +
        `${String(record.conversion.measurements.nodes).padStart(3)} nodes  ` +
        `${String(record.conversion.measurements.fields).padStart(2)} fields  ` +
        `${record.conversion.renderHash}`,
    )
  }
  lines.push('')
  lines.push('every definition')
  for (const record of run.records) {
    lines.push(
      `  ${record.provenance.id.padEnd(32)}${record.status.padEnd(16)}` +
        `${record.reasons.map(reason => reason.code).join(' ')}`,
    )
  }
  return `${lines.join('\n')}\n`
}

function percent(count: number, total: number): string {
  if (total === 0) return '0.0%'
  // One decimal place, computed on integers so no platform's float formatting
  // gets a say in what the bytes are.
  const tenths = Math.round((count * 1000) / total)
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`
}

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line === '') {
      line = word
      continue
    }
    if (line.length + 1 + word.length > width) {
      out.push(line)
      line = word
      continue
    }
    line += ` ${word}`
  }
  if (line !== '') out.push(line)
  return out
}
