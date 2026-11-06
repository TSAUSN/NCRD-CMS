// One import run: read the catalogue, convert every definition, count the
// result.
//
// A run is a value, not a side effect. Nothing here writes a file, prints a
// line, or reads a clock — `report.ts` turns a run into bytes and `cli.ts`
// decides where those bytes go, and keeping those three apart is what makes
// "rerunning the same input produces byte-identical output" a thing a test can
// assert rather than a thing a person can check.
//
// Determinism, concretely: definitions are sorted by id at the source, reasons
// are sorted by their declared order, class lists and attribute names are
// sorted, and no `Map` or `Set` iteration order reaches an output. There is no
// timestamp, no absolute path, and no random anything, and the run ID is derived
// from the input hashes rather than from when the run happened.

import { renderStructuredBody } from '@cms/renderer'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import { compareRenderings, partitionDifferences, v1DefaultValues } from './parity.ts'
import { classesInStylesheet } from './presets.ts'
import { convertDefinition, type Conversion } from './convert.ts'
import { reason, IMPORT_STATUSES, REASON_ORDER, type ImportStatus, type Reason } from './reasons.ts'
import { readV1Catalogue, type ReadOptions, type SourceManifest, type V1Definition } from './source.ts'
import { IMPORTER_VERSION } from './version.ts'

export type Provenance = {
  id: string
  /** Relative to the V1 root. An absolute path is a fact about one laptop. */
  sourceFile: string
  /** 1-based; 0 when the generated file's shape did not name a line. */
  sourceLine: number
  /** The markup this import read, by content. Never the markup. */
  htmlSha256: string
  cssSha256: string
}

export type SiteVariantRecord = {
  sourceSite: string
  parity: {
    status: 'not-convertible' | 'value-extraction-needs-review' | 'renderer-refused' | 'pass' | 'different'
    substantiveDifferences: number | null
  }
  provenance: Provenance
  slotCount: number
  status: ImportStatus
  reasons: Reason[]
  conversion: Conversion
}

export type ImportRecord = {
  provenance: Provenance
  category: string
  family: string | null
  /** `shared` when the registry scopes it to no site in particular. */
  scope: 'shared' | 'site-specific'
  sites: string[]
  slotCount: number
  status: ImportStatus
  reasons: Reason[]
  conversion: Conversion
  variants: SiteVariantRecord[]
}

export type ImportRun = {
  importerVersion: number
  runId: string
  manifest: SourceManifest
  records: ImportRecord[]
  counts: {
    definitions: number
    byStatus: Record<ImportStatus, number>
    /** Separate subreceipts, never added to the parent definition denominator. */
    siteVariants: { definitions: number; variants: number; byStatus: Record<ImportStatus, number> }
    /** How many definitions each reason code accounts for, highest first. */
    byReason: { code: string; definitions: number }[]
    /**
     * Definitions whose only obstacle is this one code.
     *
     * The actionable number: it says what widening the model by exactly one
     * thing would buy, as opposed to how many definitions mention a code
     * somewhere in a list of six.
     */
    soleReason: { code: string; definitions: number }[]
  }
}

export type RunOptions = ReadOptions

export function runImport(options: RunOptions): ImportRun {
  const catalogue = readV1Catalogue(options, classesInStylesheet)

  const records = catalogue.definitions.map((definition): ImportRecord => {
    const external: Reason[] = []
    if (catalogue.divergingIds.includes(definition.id)) {
      external.push(
        reason(
          'site-divergence',
          String(catalogue.siteVariants.filter(variant => variant.id === definition.id).length),
        ),
      )
    }
    const anchors = catalogue.unresolvedAnchors.get(definition.id)
    if (anchors !== undefined && anchors.length > 0) {
      external.push(reason('unresolved-anchor', anchors.join(' ')))
    }

    const conversion = convertDefinition({
      id: definition.id,
      html: definition.html,
      css: definition.css,
      slots: definition.slots,
      presetClasses: catalogue.presetClasses,
      presetCss: catalogue.presetCss,
      external,
    })

    const variants = catalogue.siteVariants
      .filter(variant => variant.id === definition.id)
      .map(variant => {
        const result = convertDefinition({
          id: variant.id,
          html: variant.html,
          css: variant.css,
          slots: variant.slots,
          presetClasses: catalogue.presetClasses,
          presetCss: catalogue.presetCss,
          external: external.filter(item => item.code !== 'site-divergence'),
        })
        const parity: SiteVariantRecord['parity'] = { status: 'not-convertible', substantiveDifferences: null }
        if (result.document) {
          const extracted = v1DefaultValues(variant.html, variant.slots)
          if (extracted.problems.length) parity.status = 'value-extraction-needs-review'
          else {
            const rendered = renderStructuredBody(
              {
                definition_kind: 'structured',
                structured_doc: result.document,
                structured_schema_version: STRUCTURED_SCHEMA_VERSION,
              },
              extracted.values,
            )
            if (rendered === null) parity.status = 'renderer-refused'
            else {
              parity.substantiveDifferences = partitionDifferences(
                compareRenderings(variant.html, rendered),
              ).substantive.length
              parity.status = parity.substantiveDifferences === 0 ? 'pass' : 'different'
            }
          }
        }
        return {
          sourceSite: variant.sourceSite,
          parity,
          provenance: provenanceOf(variant),
          slotCount: variant.slots.length,
          status: result.status,
          reasons: result.reasons,
          conversion: result,
        }
      })
    return {
      variants,
      provenance: provenanceOf(definition),
      category: definition.category,
      family: definition.family,
      scope: definition.sites === null ? 'shared' : 'site-specific',
      sites: definition.sites ?? [],
      slotCount: definition.slots.length,
      status: conversion.status,
      reasons: conversion.reasons,
      conversion,
    }
  })

  return {
    importerVersion: IMPORTER_VERSION,
    runId: catalogue.runId,
    manifest: catalogue.manifest,
    records,
    counts: countRun(records),
  }
}

function provenanceOf(definition: V1Definition): Provenance {
  return {
    id: definition.id,
    sourceFile: definition.sourcePath,
    sourceLine: definition.sourceLine,
    htmlSha256: definition.htmlSha256,
    cssSha256: definition.cssSha256,
  }
}

function countRun(records: readonly ImportRecord[]): ImportRun['counts'] {
  const byStatus = Object.fromEntries(IMPORT_STATUSES.map(s => [s, 0])) as Record<ImportStatus, number>
  for (const record of records) byStatus[record.status] += 1

  const perCode = new Map<string, number>()
  const perSole = new Map<string, number>()
  for (const record of records) {
    for (const code of new Set(record.reasons.map(r => r.code))) {
      perCode.set(code, (perCode.get(code) ?? 0) + 1)
    }
    const codes = new Set(record.reasons.map(r => r.code))
    if (codes.size === 1) {
      const only = [...codes][0]!
      perSole.set(only, (perSole.get(only) ?? 0) + 1)
    }
  }

  // Sorted by count and then by the declared reason order, never by a Map's
  // insertion order — which would be the order 118 definitions happened to hit
  // their first refusal in.
  const rank = (entries: Map<string, number>): { code: string; definitions: number }[] =>
    [...entries]
      .map(([code, definitions]) => ({ code, definitions }))
      .sort((a, b) => b.definitions - a.definitions || REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code))

  const variantStatus = Object.fromEntries(IMPORT_STATUSES.map(status => [status, 0])) as Record<ImportStatus, number>
  for (const record of records) for (const variant of record.variants) variantStatus[variant.status]++
  const siteVariants = {
    definitions: records.filter(record => record.variants.length > 0).length,
    variants: records.reduce((total, record) => total + record.variants.length, 0),
    byStatus: variantStatus,
  }
  return { definitions: records.length, byStatus, siteVariants, byReason: rank(perCode), soleReason: rank(perSole) }
}
