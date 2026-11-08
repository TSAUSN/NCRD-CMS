import { ensureStoriesList } from '../src/lib/sawso-site.ts'
import { ensureSawsoDemo, type DemoPhoto } from '../src/lib/sawso-demo.ts'
import { processMediaUpload } from '../../worker/src/media.ts'
import { createPostgresMediaProcessingRepository } from '../../worker/src/media-repository.ts'
import { ensureChapterRedirects } from '../src/lib/redirects.ts'
// Fill the demo database: three people and the committed local examples from
// demo/sites, and a first
// release that puts each site on its preview address. Everything goes through
// the product's own commands (import, release), so this is also a smoke test of
// both. Safe to run again: a site that is already there is left alone.
//
//   cd apps/admin && node --conditions=react-server --experimental-strip-types scripts/demo-data.ts
//
// Needs DATABASE_URL (migration owner, for the first super admin only),
// DATABASE_URL_AUTHENTICATED and the media store variables. `pnpm demo` sets
// all of them.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { asUser, closePools, configuredMediaStore, poolFor } from '@cms/platform'
import { importSiteArchive } from '../src/lib/site-portability.ts'
import { executeSiteRelease, planSiteRelease, releaseCandidates } from '../src/lib/releases.ts'
import { ensureEchelonSite, prepareEchelonDemoPhotos } from '../src/lib/echelon-site.ts'
import { ensureChapterDemoPages } from '../src/lib/chapters.ts'

const ARCHIVES = join(dirname(fileURLToPath(import.meta.url)), '../../../demo/sites')
const DEMO_PEOPLE = [
  { email: 'admin@example.test', name: '[Super admin]', role: 'super_admin' },
  { email: 'editor@example.test', name: '[Site editor]', role: 'editor' },
  { email: 'contributor@example.test', name: '[Content creator]', role: 'contributor' },
] as const
const BT_REVIEWED_HASH = '82b93c465f3b5804296a776cc0aaa64d43266494b58a17997c4bcae885e8ca8a'
const SAWSO_REVIEWED_HASH = '70441c36b16aa78e0a365311f8a0fba885f2ac344e50a7c9f7983af2cb4fb0d6'
export const DEMO_SITES = [
  { file: 'sawso-photos.json.gz', slug: 'sawso', name: 'SAWSO', reviewedHash: SAWSO_REVIEWED_HASH },
  {
    file: 'better-together-2027-original.cms-site.json.gz',
    slug: 'bt2027-r8',
    name: 'Better Together 2027',
    reviewedHash: BT_REVIEWED_HASH,
  },
  { file: 'human-needs-index.cms-site.json.gz', slug: 'hni', name: 'Human Needs Index' },
  { file: 'echelon-symposium.cms-site.json.gz', slug: 'echelon', name: 'Echelon Symposium' },
] as const satisfies readonly { file: string; slug: string; name: string; reviewedHash?: string }[]

/** Approval belongs to this exact, locally reviewed fixture, never to an
 * arbitrary archive placed in the directory. Normal imports still need review. */
export function reviewedDemoArchive(site: { name: string; reviewedHash?: string }, bytes: Uint8Array): boolean {
  if (!site.reviewedHash) return false
  if (createHash('sha256').update(bytes).digest('hex') !== site.reviewedHash)
    throw new Error('The reviewed demo archive changed. Review its files before replacing the fixture hash.')
  return true
}

async function superAdmin(): Promise<string> {
  // Nobody can authorize the first super admin, so the migration owner adds
  // it, as an operator does on a new installation (packages/seeds does the same).
  const owner = await poolFor('migration').connect()
  try {
    const { email, name } = DEMO_PEOPLE[0]
    const found = (await owner.query<{ id: string }>('SELECT id FROM app_users WHERE email=$1', [email])).rows[0]
    if (found) return found.id
    const id = (
      await owner.query<{ id: string }>(
        'INSERT INTO app_users (email, display_name, auth_subject) VALUES ($1,$2,$3) RETURNING id',
        [email, name, `local|${email}`],
      )
    ).rows[0]!.id
    await owner.query("INSERT INTO global_roles (user_id, role) VALUES ($1,'super_admin')", [id])
    return id
  } finally {
    owner.release()
  }
}

export async function importSite(
  adminId: string,
  site: (typeof DEMO_SITES)[number],
): Promise<{ id: string; created: boolean }> {
  const bytes = readFileSync(join(ARCHIVES, site.file))
  const reviewed = reviewedDemoArchive(site, bytes)
  const existing = await asUser(
    { userId: adminId },
    async client =>
      (
        await client.query<{ id: string; initial_release_required: boolean }>(
          'SELECT id,initial_release_required FROM sites WHERE slug=$1 AND archived_at IS NULL',
          [site.slug],
        )
      ).rows[0],
  )
  if (existing && (site.slug !== 'sawso' || !existing.initial_release_required)) {
    if (site.slug === 'sawso') await asUser({ userId: adminId }, client => ensureStoriesList(client, existing.id))
    return { id: existing.id, created: false }
  }
  const archive = JSON.parse(gunzipSync(bytes).toString('utf8'))
  if (site.slug === 'sawso') {
    if (archive.format !== 'cms-demo-media-v1' || !Array.isArray(archive.photos) || archive.photos.length !== 40)
      throw new Error('The reviewed SAWSO photo pack is incomplete.')
    const media = configuredMediaStore()
    const repository = createPostgresMediaProcessingRepository(poolFor('worker'), 'demo-sawso-media')
    return ensureSawsoDemo(adminId, archive.photos as DemoPhoto[], media, id =>
      processMediaUpload(id, { media, repository }),
    )
  }
  const id = await importSiteArchive(
    adminId,
    randomUUID(),
    { slug: site.slug, name: site.name },
    archive,
    configuredMediaStore(),
    reviewed,
  )
  return { id, created: true }
}

/** The site's first release: every page, the design, header, footer and menu. */
export function demoReadinessOverride(
  site: { name: string; reviewedHash?: string },
  checks: { title: string; report: { blocking: { rule: string; message: string }[] } }[],
): string {
  const findings = checks.flatMap(check => check.report.blocking.map(finding => ({ ...finding, title: check.title })))
  if (!findings.length) return ''
  if (site.reviewedHash === SAWSO_REVIEWED_HASH && findings.every(finding => finding.rule === 'sample_content'))
    return 'Confirmed: Publish with sample content.'
  const reviewed =
    site.reviewedHash === BT_REVIEWED_HASH &&
    findings.every(
      finding =>
        (finding.rule === 'missing_h1' && ['Manifesto', 'Workshops'].includes(finding.title)) ||
        (finding.rule === 'image_without_alt' && ['Better Together 2027', 'Manifesto'].includes(finding.title)),
    )
  if (!reviewed)
    throw new Error(
      `The demo release has blocking findings:\n  ${findings.map(finding => finding.title + ': ' + finding.message).join('\n  ')}`,
    )
  return 'Reviewed original BT2027 local fixture: preserve the source headings and unavailable-image descriptions for source fidelity. Owner review is required before hosted reuse; no production publication.'
}
async function publishEverything(adminId: string, siteId: string, site: (typeof DEMO_SITES)[number]): Promise<number> {
  const candidates = await asUser({ userId: adminId }, client => releaseCandidates(client, siteId))
  if (!candidates.length) return 0
  const releaseId = randomUUID()
  const plan = await planSiteRelease(adminId, releaseId, siteId, candidates)
  await executeSiteRelease(adminId, releaseId, demoReadinessOverride(site, plan.preview_report))
  return candidates.length
}

async function people(adminId: string, siteIds: string[]): Promise<void> {
  await asUser({ userId: adminId }, async client => {
    for (const person of DEMO_PEOPLE.slice(1)) {
      const id = (
        await client.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [person.email, person.name])
      ).rows[0]!.id
      for (const siteId of siteIds)
        await client.query('SELECT app.set_site_membership($1,$2,$3)', [id, siteId, person.role])
    }
  })
  // Local sign-in matches the account by this subject, as the seed does.
  const owner = await poolFor('migration').connect()
  try {
    for (const person of DEMO_PEOPLE.slice(1)) {
      await owner.query('UPDATE app_users SET auth_subject=$1 WHERE email=$2 AND auth_subject IS NULL', [
        `local|${person.email}`,
        person.email,
      ])
    }
  } finally {
    owner.release()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const adminId = await superAdmin()
    const siteIds: string[] = []
    for (const site of DEMO_SITES) {
      const { id, created } = await importSite(adminId, site)
      siteIds.push(id)
      // Only a site that has never been released is published here, so a
      // second run never puts someone's unfinished drafts live.
      const neverReleased = await asUser(
        { userId: adminId },
        async client =>
          (
            await client.query<{ initial_release_required: boolean }>(
              'SELECT initial_release_required FROM sites WHERE id=$1',
              [id],
            )
          ).rows[0]!.initial_release_required,
      )
      const published = neverReleased ? await publishEverything(adminId, id, site) : 0
      console.log(
        `${site.name}: ${created ? 'imported' : 'already present'}${published ? `, first release published (${published} items)` : ''} — http://${site.slug}.staging.localhost`,
      )
    }
    await people(adminId, siteIds)
    const chapters = await asUser({ userId: adminId }, client => ensureEchelonSite(client, randomUUID()))
    const firstChaptersRelease = await asUser(
      { userId: adminId },
      async client =>
        (await client.query('SELECT initial_release_required FROM sites WHERE id=$1', [chapters.siteId])).rows[0]
          ?.initial_release_required,
    )
    if (firstChaptersRelease) {
      await asUser({ userId: adminId }, client => prepareEchelonDemoPhotos(client, chapters.siteId))
      const candidates = await asUser({ userId: adminId }, client => releaseCandidates(client, chapters.siteId))
      const plan = await planSiteRelease(adminId, randomUUID(), chapters.siteId, candidates)
      if (
        plan.preview_report.flatMap(check => check.report.blocking).some(finding => finding.rule !== 'sample_content')
      ) {
        throw new Error('The chapters demo has a blocking readiness finding. Review it in Publish before continuing.')
      }
      await executeSiteRelease(adminId, plan.id, 'Confirmed: Publish with sample content.')
    }
    console.log(`Echelon chapters: separate native site — http://${chapters.hostname}; existing drafts preserved`)
    await asUser({ userId: adminId }, async client => {
      await ensureChapterDemoPages(client, chapters.siteId)
      await ensureChapterRedirects(client, chapters.siteId)
    })
    console.log(`people: ${DEMO_PEOPLE.map(person => `${person.email} (${person.role.replace('_', ' ')})`).join(', ')}`)
  } finally {
    await closePools()
  }
}
