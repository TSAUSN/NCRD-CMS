// Owner-operated bootstrap. Default: offline dry run. Organization commands are
// run only by the Google project administrator; phases never delete resources or overwrite content.
import { readFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validateTarget, assertActiveScope, scopedArgs, cloud } from './google-bootstrap/scope.mjs'
import { root, phases, apis, roles, bucket, identity, sqlMachineArgs } from './google-bootstrap/common.mjs'
import { infrastructure } from './google-bootstrap/infrastructure.mjs'
import { database } from './google-bootstrap/credentials.mjs'
import { uploadMedia, validateLocalInputs } from './google-bootstrap/files.mjs'
import { build, deploy, hosting } from './google-bootstrap/deployment.mjs'
import { operations } from './google-bootstrap/operations.mjs'
import { verify } from './google-bootstrap/verification.mjs'
export { containsReviewed } from './google-bootstrap/operations.mjs'

export function bootstrapPlan(config, target) {
  validateTarget(config, target)
  const command = args => ['gcloud', ...scopedArgs(config, args)]
  return {
    project: config.projectId,
    account: config.operatorAccount,
    revision: config.revision,
    dryRun: true,
    administratorPrerequisites: [
      'Organization administrator: verify project ID/number, billing enabled and budget alerts/spending controls.',
      'Organization administrator: authorize service enablement, IAM bindings/service-account attachment, SQL creation and public invocation mechanism.',
      'Super admin: preserve the existing personal Supabase provider/subject, add the exact new callback and verify sign-in. Provider migration, SMTP and real-editor delivery are separate reviewed work.',
      'Maintainer: supply checksum-verified cleaned dump, media inventory/files, private operator directory and official Cloud SQL Auth Proxy.',
      'Organization administrator: create/verify an email notification channel and provide its target-project resource name.',
    ],
    phases: [
      {
        phase: 'infrastructure',
        commands: [
          command(['services', 'enable', ...apis.map(x => x + '.googleapis.com')]),
          ...roles.map(role => command(['iam', 'service-accounts', 'create', 'cms-' + role])),
          ...['media', 'backups', 'build-source'].map(role =>
            command([
              'storage',
              'buckets',
              'create',
              'gs://' + bucket(config, role),
              '--location=' + config.region,
              '--uniform-bucket-level-access',
              '--public-access-prevention',
            ]),
          ),
          command([
            'artifacts',
            'repositories',
            'create',
            'cms-v2',
            '--repository-format=docker',
            '--location=' + config.region,
          ]),
          command([
            'sql',
            'instances',
            'create',
            config.sqlInstance,
            '--database-version=POSTGRES_16',
            '--edition=ENTERPRISE',
            ...sqlMachineArgs(config.sqlTier),
            '--region=' + config.region,
            '--availability-type=ZONAL',
            '--storage-type=SSD',
            '--storage-size=10',
            '--no-storage-auto-increase',
            '--deletion-protection',
            '--backup-start-time=07:00',
            '--retained-backups-count=7',
            '--enable-point-in-time-recovery',
            '--retained-transaction-log-days=7',
          ]),
        ],
        notes: [
          'Every create first checks existence; existing resources are never deleted. SQL creation additionally requires --allow-create-sql.',
          'Adds Firebase with the Management API and narrowly scoped IAM grants; no service-account keys.',
        ],
      },
      {
        phase: 'database',
        notes: [
          'The Google project administrator starts the loopback proxy with the explicit target/account.',
          'Back up; restore only into an empty database, preserving RLS/owners/grants; verify archive checksum; apply immutable migrations.',
          'Create restricted runtime logins; pin database/backup secrets; never use demo reset or local fixture logins.',
        ],
      },
      {
        phase: 'media',
        notes: [
          'Verify every local SHA-256 against inventory; upload missing objects with ifGenerationMatch=0; refuse differing existing bytes.',
        ],
      },
      {
        phase: 'build',
        commands: [
          command([
            'builds',
            'submit',
            'PRIVATE/committed-source.tar.gz',
            '--config=' + join(root, 'deploy/google/cloudbuild.yaml'),
            '--gcs-source-staging-dir=gs://' + bucket(config, 'build-source') + '/submissions',
            '--service-account=projects/' + config.projectId + '/serviceAccounts/' + identity(config, 'builder'),
            '--substitutions=_REVISION=' + config.revision.slice(0, 7) + ',_POSTGRES_MAJOR=16',
            '--async',
          ]),
        ],
        notes: ['Archive the exact committed revision, wait for SUCCESS and preserve runtime/recovery digests.'],
      },
      {
        phase: 'deploy',
        notes: [
          'Generate private manifests with pinned secrets/digests and bounded pools/instances. Deploy site, admin, private worker and backup job.',
          'Apply only the explicit IT-selected public invocation mechanism to admin/site; worker stays private.',
        ],
      },
      {
        phase: 'hosting',
        notes: [
          'Audit/rebind only three kept native web.app hosts; never touch DNS/custom domains.',
          'Create the three Hosting sites and Cloud Run rewrites through the existing Hosting client.',
        ],
      },
      {
        phase: 'operations',
        notes: [
          'Install administrator-channel worker/public-error/backup alerts; run one authenticated worker pass.',
          'Create minute OIDC worker Scheduler and twice-daily OAuth backup Scheduler; run a first encrypted backup.',
          'Scheduling stays disabled until the administrator confirms receipt of a test alert and successful backup/worker checks.',
        ],
      },
      {
        phase: 'verify',
        notes: [
          'Check /health on admin/site, all published routes/assets, anonymous worker refusal and worker heartbeat.',
          'Owner walks demo-route in ordinary Chrome with the existing personal Supabase account (Friday is owner-only). Backup restore rehearsal and rollback gate remain mandatory.',
        ],
      },
    ],
  }
}

export async function main(argv = process.argv.slice(2)) {
  const get = flag => {
    const i = argv.indexOf(flag)
    return i < 0 ? undefined : argv[i + 1]
  }
  const known = new Set([
    '--config',
    '--project',
    '--account',
    '--phase',
    '--execute',
    '--dry-run',
    '--allow-create-sql',
    '--owner-operated',
  ])
  for (let i = 0; i < argv.length; i++) {
    if (!known.has(argv[i])) throw Error('Unknown bootstrap argument: ' + argv[i])
    if (['--config', '--project', '--account', '--phase'].includes(argv[i])) i++
  }
  const config = JSON.parse(readFileSync(get('--config') ?? '', 'utf8'))
  const plan = bootstrapPlan(config, { project: get('--project'), account: get('--account') })
  const inputs = await validateLocalInputs(config)
  const selected = get('--phase') ?? 'all'
  if (selected !== 'all' && !phases.includes(selected)) throw Error('Unknown phase.')
  if (!argv.includes('--execute')) {
    console.log(JSON.stringify({ ...plan, selectedPhase: selected, validatedLocalInputs: inputs }, null, 2))
    return
  }
  if (argv.includes('--dry-run')) throw Error('Choose either dry run or execution.')
  if (!argv.includes('--owner-operated'))
    throw Error('Execution requires the Google project administrator to supply --owner-operated.')
  if (config.administratorPrerequisitesConfirmed !== true)
    throw Error('Administrator prerequisites and billing/public-access decisions must be confirmed before execution.')
  if (!['db-f1-micro', 'db-g1-small', 'db-custom-1-3840'].includes(config.sqlTier))
    throw Error('Choose the reviewed bounded SQL tier.')
  if (
    !Number.isInteger(config.proxyPort) ||
    config.proxyPort < 1024 ||
    config.proxyPort > 65535 ||
    [3000, 3001, 54329].includes(config.proxyPort)
  )
    throw Error('Use a dedicated loopback SQL proxy port.')
  if (!/^[a-z][a-z0-9-]{1,11}[a-z0-9]$/.test(config.firebaseSitePrefix ?? ''))
    throw Error('Supply the reviewed Firebase site prefix.')
  if (
    !config.privateDirectory ||
    !config.cleanedDump ||
    !config.mediaDirectory ||
    !config.mediaInventory ||
    !config.ownerEmail ||
    !config.cleanedFingerprints
  )
    throw Error('Supply private operator/content/media inputs.')
  config.privateDirectory = resolve(config.privateDirectory)
  mkdirSync(config.privateDirectory, { recursive: true, mode: 0o700 })
  if (statSync(config.privateDirectory).mode & 0o077) throw Error('Private directory must be mode 700.')
  if (
    spawnSync('git', ['-C', config.privateDirectory, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
      .status === 0
  )
    throw Error('Private directory must be outside Git.')
  assertActiveScope(config)
  const active = cloud(config, ['auth', 'list', '--filter=status:ACTIVE', '--format=json(account,status)'], {
    json: true,
  })
  if (active.length !== 1 || active[0].account !== config.operatorAccount)
    throw Error('Active authenticated account differs.')
  const project = cloud(
    config,
    ['projects', 'describe', config.projectId, '--format=json(projectId,projectNumber,lifecycleState)'],
    { json: true },
  )
  if (
    project.projectId !== config.projectId ||
    String(project.projectNumber) !== config.projectNumber ||
    project.lifecycleState !== 'ACTIVE'
  )
    throw Error('Project identity/state differs from reviewed target.')
  const run = {
    infrastructure: () => infrastructure(config, { allowCreateSql: argv.includes('--allow-create-sql') }),
    database: () => database(config),
    media: () => uploadMedia(config),
    build: () => build(config),
    deploy: () => deploy(config),
    hosting: () => hosting(config),
    operations: () => operations(config),
    verify: () => verify(config),
  }
  for (const phase of selected === 'all' ? phases : [selected]) {
    console.log('Starting ' + phase + ' for ' + config.projectId)
    await run[phase]()
    console.log('Completed ' + phase)
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
