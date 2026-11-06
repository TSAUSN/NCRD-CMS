// The importer, from a shell.
//
// Dry run by default, and there is no flag that changes what it reads. The V1
// checkout is opened read-only in the one function that opens it at all
// (`source.ts`), and the only `writeFileSync` in this package is below, pointed
// at a directory the caller named. There is no mode, flag, environment variable
// or code path that writes anywhere near V1, which is a property worth being
// able to establish by reading rather than by trusting.
//
// `--documents` is separate from `--out` on purpose. The report is provenance —
// ids, hashes, statuses, reason codes — and carries nothing from the V1
// catalogue. The documents are a transformation *of* that catalogue, so writing
// them is a deliberate act with a licensing question attached, and it defaults
// to off rather than to a path somebody might not notice.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inventoryFieldAttributes, type FieldAttributeInventory } from './field-attributes.ts'
import { inventoryCsv, inventoryJson, inventoryMarkdown } from './field-attributes-report.ts'
import { reportCsv, reportJson, reportSummary } from './report.ts'
import { runImport, type RunOptions } from './run.ts'

const USAGE = `usage: importer [--v1 <path>] [--repo <path>] [--out <dir>] [--documents <dir>]
       importer inventory [--v1 <path>] [--repo <path>] [--out <dir>]

  --v1         the V1 checkout to read. Read-only; never written to.
  --repo       this repository, for docs/v1-inventory/summary.json.
  --out        where to write. Defaults to nothing for the classification run,
               and to <repo>/docs/v1-inventory for the inventory.
  --documents  additionally write the converted structured documents here.

With no --out, the classification run writes nothing and its summary goes to
stdout.

The inventory subcommand is a different question about the same catalogue: not
"which definitions convert" but "what would a link or image field node lose, and
what is the smallest attribute allowlist that would change that". It writes
field-attributes.json, field-attributes.csv and field-attributes.md, all three
provenance-only and byte-identical on a rerun over the same inputs.
`

/** The repository root, from this file's own location rather than from cwd. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// No default. V1 is a separate, licensed checkout that lives wherever an
// operator put it, and baking one machine's home directory into a tracked file
// is both wrong everywhere else and a small disclosure of where this was run.
// Say `--v1 <path>` or set V1_ROOT.

function argument(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name)
  if (at === -1) return undefined
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a path`)
  return value
}

export function main(argv: readonly string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return 0
  }

  const v1Root = argument(argv, '--v1') ?? process.env['V1_ROOT']
  if (v1Root === undefined) {
    process.stderr.write('the V1 checkout has no default location: pass --v1 <path> or set V1_ROOT\n')
    return 2
  }
  const repoRoot = argument(argv, '--repo') ?? REPO_ROOT

  // A subcommand rather than a flag on the classification run: the two produce
  // different files, answer different questions, and share only their inputs.
  // Folding the inventory into `--out` would mean one directory holding two
  // reports that happen to have been produced together.
  if (argv[0] === 'inventory') {
    return inventory({ v1Root, repoRoot }, argument(argv, '--out') ?? path.join(repoRoot, 'docs', 'v1-inventory'))
  }

  const run = runImport({ v1Root, repoRoot })

  const out = argument(argv, '--out')
  if (out === undefined) {
    process.stdout.write(reportSummary(run))
    process.stdout.write('\ndry run: nothing written. Pass --out <dir> to write the report.\n')
    return 0
  }

  mkdirSync(out, { recursive: true })
  writeFileSync(path.join(out, 'report.json'), reportJson(run))
  writeFileSync(path.join(out, 'report.csv'), reportCsv(run))
  writeFileSync(path.join(out, 'summary.txt'), reportSummary(run))
  process.stdout.write(reportSummary(run))
  process.stdout.write(`\nwrote report.json, report.csv and summary.txt to ${out}\n`)

  const documents = argument(argv, '--documents')
  if (documents !== undefined) {
    mkdirSync(documents, { recursive: true })
    let written = 0
    for (const record of run.records) {
      const document = record.conversion.document
      if (document === null) continue
      writeFileSync(
        path.join(documents, `${record.provenance.id}.json`),
        `${JSON.stringify(
          {
            id: record.provenance.id,
            document,
            css: record.conversion.compiledCss,
            renderHash: record.conversion.renderHash,
          },
          null,
          2,
        )}\n`,
      )
      written += 1
    }
    process.stdout.write(`wrote ${written} structured documents to ${documents}\n`)
  }
  return 0
}

/**
 * The attribute inventory, written to a directory the caller named.
 *
 * Three files, and a one-screen summary on stdout so the person who ran it can
 * see the headline without opening any of them. Nothing here reads a clock or
 * prints a path from outside the repository, so running it twice and diffing the
 * output directory is a check anybody can perform in two commands.
 */
function inventory(options: RunOptions, out: string): number {
  const result: FieldAttributeInventory = inventoryFieldAttributes(options)
  mkdirSync(out, { recursive: true })
  writeFileSync(path.join(out, 'field-attributes.json'), inventoryJson(result))
  writeFileSync(path.join(out, 'field-attributes.csv'), inventoryCsv(result))
  writeFileSync(path.join(out, 'field-attributes.md'), inventoryMarkdown(result))

  const counts = result.counts
  const top = result.allowlist.combined.reduce(
    (best, step) => (step.cumulativeCleared > best.cumulativeCleared ? step : best),
    result.allowlist.combined[0] ?? { cumulativeCleared: 0, cumulativeUnlocked: 0 },
  )
  process.stdout.write(
    [
      `run                        ${result.runId}`,
      `definitions                ${counts.definitions}`,
      `field-attributes-lost      ${counts.fieldAttributesLostCode}`,
      `unsupported-attribute      ${counts.unsupportedAttributeCode}`,
      `carrying both codes        ${counts.bothCodes}`,
      `either, overlap removed    ${counts.eitherCode}`,
      `losses present, uncoded    ${counts.lostButNotCoded}`,
      `a full allowlist clears    ${top.cumulativeCleared}`,
      `and unlocks outright       ${top.cumulativeUnlocked}`,
      '',
      `wrote field-attributes.json, field-attributes.csv and field-attributes.md to ${out}`,
      '',
    ].join('\n'),
  )
  return 0
}

// `process.argv[1]` rather than an unconditional call, so importing this module
// from a test does not run the importer as a side effect of the import.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2))
}
