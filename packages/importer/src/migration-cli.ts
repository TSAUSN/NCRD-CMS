import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { canonical } from './backup.ts'
import { createMigration, migrationMarkdown } from './migration.ts'
import { importReferenceDrafts } from './database.ts'
import { createFilesystemMediaStore } from '../../platform/src/local/index.ts'
import { applyWorkingDrafts, planWorkingDrafts, workingPlanHash, type WorkingDraftPlan } from './working-drafts.ts'
import { applyFrameComponents } from './frame-components.ts'
import { importCatalogueLibrary } from './catalogue-library-database.ts'
import { LIBRARY_SITES, type LibrarySite } from './catalogue-library.ts'
import { readV1Catalogue } from './source.ts'
import { classesInStylesheet } from './presets.ts'
import { collectSourceDrawings, readIconLibrary, sourceDrawingsModule } from './source-drawings.ts'
import { readV1PageTemplates } from './page-templates.ts'
import { importPageTemplates } from './page-templates-database.ts'
import { digest } from './backup.ts'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name)
  if (at < 0) return undefined
  const value = args[at + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}
const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function checkOutput(destination: string, protectedRoots: string[]): string {
  const absolute = path.resolve(destination)
  let ancestor = absolute
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const resolved = path.join(realpathSync(ancestor), path.relative(ancestor, absolute))
  for (const root of protectedRoots) {
    const base = realpathSync(root)
    if (resolved === base || resolved.startsWith(`${base}${path.sep}`))
      throw new Error('output must be outside every V1 source and backup root')
  }
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) throw new Error('output cannot replace a symlink')
  return absolute
}

async function asOperator<T>(args: string[], fn: (client: Client) => Promise<T>): Promise<T> {
  const actor = required(arg(args, '--actor') ?? process.env.IMPORT_ACTOR_ID, '--actor or IMPORT_ACTOR_ID')
  if (!/^[0-9a-f-]{36}$/i.test(actor)) throw new Error('operator must be a V2 user UUID')
  const client = new Client({ connectionString: required(process.env.IMPORT_DATABASE_URL, 'IMPORT_DATABASE_URL') })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.user_id', actor])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

export async function migrationMain(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    process.stdout.write(
      `V1 offline migration\n\nprepare --v1 ROOT --backup DIR [--out REPORT_DIR] [--package PRIVATE_JSON]\ndrafts --v1 ROOT --backup DIR --prefix PREFIX --staging-apex HOST --media-root DIR --actor UUID\nstatus --run RUN_UUID --actor UUID\nplan-working --run RUN_UUID --plan PRIVATE_JSON --actor UUID\napply-working --plan PRIVATE_JSON --actor UUID\nframe --run RUN_UUID --site SITE_UUID --v1 SOURCE_REPO --actor SUPER_ADMIN_UUID\nlibrary --run RUN_UUID --site SITE_UUID --source humanneedsindex|echelonsymposium --v1 ROOT --media-root DIR --actor SUPER_ADMIN_UUID [--refresh]\ndrawings --v1 ROOT --out FILE\npage-templates --run RUN_UUID --site SITE_UUID --source humanneedsindex|echelonsymposium --v1 ROOT --actor SUPER_ADMIN_UUID\nreview --record UUID --revision N --disposition needs_review|mapped|exception --note TEXT --evidence TEXT [--target VERSION_UUID] [--request UUID] --actor UUID\n\nDatabase commands require explicit IMPORT_DATABASE_URL. Drafts are private source references; they never publish or activate imported users. Working drafts restore normal page names/addresses and internal links, preserving immutable source snapshots and exact-version publication review. Reports contain provenance and counts; --package additionally writes private source data. Images use the product decoder, responsive variants and Media governance; unsupported assets remain explicit review items.\n`,
    )
    return
  }
  const command = args[0] ?? 'prepare'
  if (command === 'plan-working') {
    const plan = await asOperator(args, client => planWorkingDrafts(client, required(arg(args, '--run'), '--run')))
    const destination = checkOutput(required(arg(args, '--plan'), '--plan'), [])
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    process.stdout.write(
      `${JSON.stringify({ planHash: workingPlanHash(plan), pages: plan.pages.length, plan: destination, published: false })}\n`,
    )
    return
  }
  if (command === 'drawings') {
    // LIB-02: the icon drawings V1's sections draw, as the code-owned set a
    // list item's icon is chosen from (packages/schema/src/content/source-drawings.generated.ts).
    const v1Root = path.resolve(required(arg(args, '--v1') ?? process.env.V1_ROOT, '--v1 or V1_ROOT'))
    const output = checkOutput(required(arg(args, '--out'), '--out'), [v1Root])
    const catalogue = readV1Catalogue({ v1Root, repoRoot: REPO }, classesInStylesheet)
    const libraryFile = path.join(v1Root, 'tsa-cms-admin', 'src', 'data', 'iconLibrary.generated.js')
    const drawings = collectSourceDrawings(
      catalogue,
      existsSync(libraryFile) ? readIconLibrary(readFileSync(libraryFile, 'utf8')) : [],
    )
    writeFileSync(output, sourceDrawingsModule(drawings))
    process.stdout.write(`${drawings.length} drawings written\n`)
    return
  }
  if (command === 'page-templates') {
    // LIB-09: V1's built-in page templates as the site's page recipes, after its library.
    const v1Root = path.resolve(required(arg(args, '--v1') ?? process.env.V1_ROOT, '--v1 or V1_ROOT'))
    const source = required(arg(args, '--source'), '--source')
    if (!Object.hasOwn(LIBRARY_SITES, source)) throw new Error('--source must be humanneedsindex or echelonsymposium')
    const templates = readV1PageTemplates(
      readFileSync(path.join(v1Root, 'tsa-cms-admin', 'src', 'sections', 'pageTemplates.js'), 'utf8'),
    )
    const result = await asOperator(args, client =>
      importPageTemplates(client, {
        runId: required(arg(args, '--run'), '--run'),
        siteId: required(arg(args, '--site'), '--site'),
        site: source as LibrarySite,
        templates,
      }),
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'library') {
    // LIB-01: the V1 section library this site was offered, as the site's own
    // faithful definitions. Existing ones are left untouched on a rerun;
    // --refresh gives an unedited one a new version when its mapping changed.
    const v1Root = path.resolve(required(arg(args, '--v1') ?? process.env.V1_ROOT, '--v1 or V1_ROOT'))
    const source = required(arg(args, '--source'), '--source')
    if (!Object.hasOwn(LIBRARY_SITES, source)) throw new Error('--source must be humanneedsindex or echelonsymposium')
    const mediaRoot = checkOutput(required(arg(args, '--media-root'), '--media-root'), [v1Root])
    const catalogue = readV1Catalogue({ v1Root, repoRoot: REPO }, classesInStylesheet)
    const result = await asOperator(args, client =>
      importCatalogueLibrary(client, {
        runId: required(arg(args, '--run'), '--run'),
        siteId: required(arg(args, '--site'), '--site'),
        site: source as LibrarySite,
        catalogue,
        sourceRoot: v1Root,
        store: createFilesystemMediaStore(mediaRoot),
        siteCss: readFileSync(
          path.join(
            v1Root,
            source === 'humanneedsindex' ? 'tsa-humanneedsindex' : 'tsa-echelonsymposium',
            'src',
            'style.css',
          ),
          'utf8',
        ),
        refresh: args.includes('--refresh'),
      }),
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'frame') {
    // ADR 0010: the source site's header and footer as saved (unpublished)
    // authored frame components, read from the built V1 repository.
    const source = path.resolve(required(arg(args, '--v1'), '--v1'))
    const assets = path.join(source, 'dist', 'assets')
    const builtCss = readdirSync(assets)
      .filter(file => file.endsWith('.css'))
      .sort()
      .map(file => readFileSync(path.join(assets, file), 'utf8'))
      .join('\n')
    if (!builtCss) throw new Error('the V1 repository has no built stylesheet; build it first')
    const result = await asOperator(args, client =>
      applyFrameComponents(client, {
        runId: required(arg(args, '--run'), '--run'),
        siteId: required(arg(args, '--site'), '--site'),
        indexHtml: readFileSync(path.join(source, 'index.html'), 'utf8'),
        builtCss,
        year: new Date().getFullYear(),
        digest,
      }),
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'apply-working') {
    const filename = required(arg(args, '--plan'), '--plan')
    if (lstatSync(filename).size > 1024 * 1024) throw new Error('working-draft plan exceeds 1 MiB')
    const plan = JSON.parse(readFileSync(filename, 'utf8')) as WorkingDraftPlan
    const result = await asOperator(args, client => applyWorkingDrafts(client, plan))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'status') {
    const result = await asOperator(
      args,
      async client =>
        (
          await client.query(
            `SELECT r.id,r.kind,r.source_site,r.source_sha256,r.issues,
      COALESCE(d.revision,0)::text AS revision,COALESCE(d.disposition,'needs_review') AS disposition,d.evidence
      FROM public.v1_import_records r LEFT JOIN LATERAL(SELECT * FROM public.v1_import_decisions x WHERE x.record_id=r.id
        ORDER BY x.revision DESC LIMIT 1)d ON true WHERE r.run_id=$1 ORDER BY r.kind,r.id`,
            [required(arg(args, '--run'), '--run')],
          )
        ).rows,
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'review') {
    const revision = Number(required(arg(args, '--revision'), '--revision'))
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('revision must be a nonnegative integer')
    const requestId = arg(args, '--request') ?? randomUUID()
    const result = await asOperator(
      args,
      async client =>
        (
          await client.query('SELECT app.review_v1_record($1,$2,$3,$4,$5,$6,$7) AS revision', [
            requestId,
            required(arg(args, '--record'), '--record'),
            revision,
            required(arg(args, '--disposition'), '--disposition'),
            required(arg(args, '--note'), '--note'),
            arg(args, '--target') ?? null,
            required(arg(args, '--evidence'), '--evidence'),
          ])
        ).rows[0],
    )
    process.stdout.write(`${JSON.stringify({ requestId, ...result })}\n`)
    return
  }
  if (!['prepare', 'drafts'].includes(command)) throw new Error('unknown V1 migration command')
  const v1Root = required(arg(args, '--v1') ?? process.env.V1_ROOT, '--v1 or V1_ROOT')
  const backupRoot = required(arg(args, '--backup'), '--backup')
  const result = createMigration({ v1Root, backupRoot, repoRoot: arg(args, '--repo') ?? REPO })
  const out = arg(args, '--out')
  if (out) {
    const destination = checkOutput(out, [v1Root, backupRoot])
    mkdirSync(destination, { recursive: true })
    for (const [filename, text] of [
      ['parity.json', `${JSON.stringify(result.report, null, 2)}\n`],
      ['parity.md', migrationMarkdown(result.report)],
    ]) {
      const output = checkOutput(path.join(destination, filename!), [v1Root, backupRoot])
      writeFileSync(output, text!)
    }
  }
  const packagePath = arg(args, '--package')
  if (packagePath) {
    const destination = checkOutput(packagePath, [v1Root, backupRoot])
    const text = `${canonical(result.bundle)}\n`
    if (existsSync(destination)) {
      if (readFileSync(destination, 'utf8') !== text)
        throw new Error('private package already exists with different content; choose a new filename')
    } else {
      mkdirSync(path.dirname(destination), { recursive: true })
      writeFileSync(destination, text, { mode: 0o600, flag: 'wx' })
    }
  }
  if (command === 'drafts') {
    const mediaRoot = checkOutput(required(arg(args, '--media-root'), '--media-root'), [v1Root, backupRoot])
    const imported = await asOperator(args, client =>
      importReferenceDrafts(client, result.bundle, {
        prefix: required(arg(args, '--prefix'), '--prefix'),
        stagingApex: required(arg(args, '--staging-apex'), '--staging-apex'),
        media: { sourceRoot: v1Root, store: createFilesystemMediaStore(mediaRoot) },
      }),
    )
    process.stdout.write(`${JSON.stringify(imported, null, 2)}\n`)
  } else process.stdout.write(migrationMarkdown(result.report))
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  migrationMain(process.argv.slice(2)).catch(error => {
    // Do not dump Postgres details: a uniqueness or shape error can quote the
    // rejected V1 record, which belongs only in the private package/journal.
    process.stderr.write(`V1 migration failed: ${(error as Error).message}\n`)
    process.exitCode = 1
  })
}
