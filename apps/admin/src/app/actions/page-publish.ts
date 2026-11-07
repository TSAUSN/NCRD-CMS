'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { asUser, evaluateVersionReadiness } from '@cms/platform'
import { DomainError, READINESS_POLICY_VERSION, type ReadinessReport } from '@cms/domain'
import { getPage } from '../../lib/queries.ts'
import { executeSiteRelease, planSiteRelease, releaseCandidates } from '../../lib/releases.ts'
import {
  administratorNeededMessage,
  needsAdministrator,
  publishTogetherItems,
  publishTogetherMessage,
  publishTogetherPlan,
} from '../../lib/publish-together.ts'
import { ActionResult, requireSession, toActionResult } from '../../lib/action-result.ts'

export async function publishPage(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const pageId = String(formData.get('pageId'))
  const expectedRevision = Number(formData.get('revision'))
  let override = String(formData.get('overrideReason') ?? '').trim()

  // These lookups sat outside the try/catch, so a database hiccup escaped the
  // server action as an unhandled rejection instead of becoming a result the
  // editor could show — and wedged the editor rather than telling anyone.
  let page: Awaited<ReturnType<typeof getPage>>
  let report: ReadinessReport
  try {
    page = await getPage(session.principal.userId, pageId)
    if (!page?.draft_version_id) {
      return { ok: false, kind: 'error', message: 'There is nothing to publish yet.' }
    }
    // One readiness policy, run before every publish path (SPEC §6.8). Run
    // here, on the server, from the version id — never from anything the
    // browser sent. The database re-checks what it can (a report was supplied,
    // its shape and policy version are valid, blocking findings need an
    // override) and independently enforces what never depends on a report at
    // all: authorization, trusted-code approval, and the revision CAS.
    report = await runReadiness(page.draft_version_id)
  } catch (error) {
    return toActionResult(error)
  }

  const hasSamples = report.blocking.some(finding => finding.rule === 'sample_content')
  const samplesConfirmed = formData.get('sampleContentConfirmed') === 'true'
  if (hasSamples && samplesConfirmed && report.blocking.every(finding => finding.rule === 'sample_content'))
    override ||= 'Confirmed: Publish with sample content.'

  // Links to pages that are not live yet, and a site's first publish, are
  // fixed by publishing more at once: offer that as one step.
  if (!override || override === 'Confirmed: Publish with sample content.') {
    const together = await asUser({ userId: session.principal.userId }, client =>
      publishTogetherPlan(client, pageId, report),
    ).catch(() => null)
    // Publishing a site's design or a list for the first time is a site
    // administrator's call; an editor is told so rather than offered a button
    // the database would refuse.
    if (together && needsAdministrator(together) && !administers(session.principal, together.siteId)) {
      return { ok: false, kind: 'blocked', report, message: administratorNeededMessage(together) }
    }
    if (together) return { ok: false, kind: 'blocked', report, together, message: publishTogetherMessage(together) }
  }

  // A group needs one decision covering every affected page. A one-page
  // sample confirmation is only useful after ruling out that group.
  if (hasSamples && !samplesConfirmed)
    return {
      ok: false,
      kind: 'blocked',
      report,
      message: 'Replace the remaining examples, or choose Publish with sample content.',
      needsSampleConfirmation: true,
    }

  if (!report.ok && !override) {
    return {
      ok: false,
      kind: 'blocked',
      report,
      message: 'This page is not ready to publish yet. Fix the items below, or publish anyway with a reason.',
    }
  }

  try {
    const revision = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ revision: string }>(
        'SELECT revision FROM app.publish_page($1,$2,$3,$4,$5)',
        [pageId, expectedRevision, report.policyVersion, override || null, JSON.stringify(report.findings)],
      )
      return Number(rows[0]!.revision)
    })
    revalidatePath(`/pages/${pageId}`)
    // Publishing copies the draft version onto the published pointer rather
    // than writing a new one, so the draft the canvas is rendering is still the
    // current one.
    return { ok: true, revision, versionId: null, message: 'Published. The live page now shows these changes.' }
  } catch (error) {
    return toActionResult(error)
  }
}

function administers(
  principal: { isSuperAdmin: boolean; memberships: ReadonlyMap<string, string> },
  siteId: string,
): boolean {
  return principal.isSuperAdmin || principal.memberships.get(siteId) === 'site_admin'
}

/**
 * Publish a page together with the not-yet-live pages it links to (and, on a
 * site's first publish, its design, header, footer and menu) as one release:
 * everything goes live at the same moment, or nothing does. The plan is worked
 * out again here from the saved drafts, never taken from the browser.
 */
export async function publishPageTogether(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const userId = session.principal.userId
  const pageId = String(formData.get('pageId') ?? '')
  const expectedRevision = String(formData.get('revision') ?? '')
  try {
    const page = await getPage(userId, pageId)
    if (!page?.draft_version_id) return { ok: false, kind: 'error', message: 'There is nothing to publish yet.' }
    const report = await runReadiness(page.draft_version_id)
    const prepared = await asUser({ userId }, async client => {
      const plan = await publishTogetherPlan(client, pageId, report)
      if (!plan) return null
      const siteId = (await client.query<{ site_id: string }>('SELECT site_id FROM pages WHERE id=$1', [pageId]))
        .rows[0]!.site_id
      return { plan, siteId, candidates: await releaseCandidates(client, siteId) }
    })
    if (!prepared) {
      return {
        ok: false,
        kind: 'blocked',
        report,
        message: 'This page is not ready to publish yet. Fix the items below, or publish anyway with a reason.',
      }
    }
    if (needsAdministrator(prepared.plan) && !administers(session.principal, prepared.siteId)) {
      return { ok: false, kind: 'blocked', report, message: administratorNeededMessage(prepared.plan) }
    }
    const own = prepared.candidates.find(item => item.type === 'page' && item.id === pageId)
    const items = publishTogetherItems(prepared.candidates, pageId, prepared.plan)
    if (!own || own.revision !== expectedRevision || !items) {
      return {
        ok: false,
        kind: 'conflict',
        currentRevision: own ? Number(own.revision) : undefined,
        message: 'One of these pages changed a moment ago. Reload to see the latest version before publishing.',
      }
    }
    const releaseId = randomUUID()
    const planned = await planSiteRelease(userId, releaseId, prepared.siteId, items)
    const confirmedSamples = formData.get('sampleContentConfirmed') === 'true'
    const blocking = planned.preview_report.flatMap(check =>
      check.report.blocking
        .filter(finding => !(confirmedSamples && check.pageId === pageId && finding.rule === 'sample_content'))
        .map(finding => `${check.title}: ${finding.message}`),
    )
    if (blocking.length) {
      await asUser({ userId }, client => client.query('SELECT app.finish_site_release($1,true,$2)', [releaseId, '{}']))
      return {
        ok: false,
        kind: 'error',
        message: `Nothing was published, because ${blocking.length === 1 ? 'one thing needs' : 'some things need'} fixing first. ${blocking.join(' ')}`,
      }
    }
    await executeSiteRelease(userId, releaseId, confirmedSamples ? 'Confirmed: Publish with sample content.' : '')
    const revision = await asUser({ userId }, async client =>
      Number(
        (await client.query<{ revision: string }>('SELECT revision FROM pages WHERE id=$1', [pageId])).rows[0]!
          .revision,
      ),
    )
    revalidatePath('/', 'layout')
    const count = items.filter(item => item.type === 'page').length
    return {
      ok: true,
      revision,
      versionId: null,
      message: prepared.plan.siteWide
        ? `Published. The site is live with ${count === 1 ? 'this page' : `${count} pages`}.`
        : `Published ${count} pages together. The live site now shows them.`,
    }
  } catch (error) {
    return toActionResult(error)
  }
}

/**
 * The editor's door to the shared evaluation (@cms/platform). The scheduler
 * calls the same function with the worker's manifest access, which is what
 * makes "the same invalid draft is refused everywhere" true rather than
 * aspirational (SPEC §6.8).
 */
export async function runReadiness(versionId: string): Promise<ReadinessReport> {
  return versionReadiness(versionId, 'member')
}

export async function runReviewReadiness(versionId: string): Promise<ReadinessReport> {
  return versionReadiness(versionId, 'review')
}

async function versionReadiness(versionId: string, access: 'member' | 'review'): Promise<ReadinessReport> {
  const session = await requireSession()
  try {
    return await asUser({ userId: session.principal.userId }, client =>
      evaluateVersionReadiness(client, versionId, access),
    )
  } catch (error) {
    // An incomplete binding must not make the entire editor inaccessible.
    // Catch outside asUser so its failed read transaction has rolled back.
    if (!(error instanceof DomainError) || error.kind !== 'invalid_state') throw error
    const message = /collection repeat|collection binding|collection selection|repeat field .*collection binding/i.test(
      error.message,
    )
      ? 'Choose a list that fits each unfinished section before publishing.'
      : error.message
    const finding = { rule: 'empty_page', severity: 'blocking', message } as const
    return {
      policyVersion: READINESS_POLICY_VERSION,
      findings: [finding],
      blocking: [finding],
      advisory: [],
      ok: false,
    }
  }
}
