'use server'

import { loadSectionUpgrade, renderUpgradeSet, type UpgradeRequest } from '../../../lib/section-upgrade-service.ts'
export type { UpgradeRequest } from '../../../lib/section-upgrade-service.ts'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@cms/domain'
import { asUser } from '@cms/platform'
import { currentSession } from '../../../lib/session.ts'
import { type SectionUpgradePlan } from '../../../lib/section-upgrade.ts'
import { type SitePreviewContext } from '../../../lib/preview-context.ts'
import type { ActionResult } from '../../../lib/action-result.ts'

export type UpgradePreview =
  | {
      ok: true
      html: string
      beforeHtml: string
      previewContext: SitePreviewContext
      plan: Omit<SectionUpgradePlan, 'values'>
      version: number
    }
  | { ok: false; message: string }

export async function previewSectionUpgrade(input: UpgradeRequest): Promise<UpgradePreview> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in to review this update.' }
  try {
    return await asUser({ userId: session.principal.userId }, async client => {
      const result = await renderUpgradeSet(client, [input])
      return {
        ok: true,
        html: result.html,
        beforeHtml: result.beforeHtml,
        previewContext: result.previewContext,
        version: input.targetVersion,
        plan: result.plans[0]!,
      }
    })
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'The update preview could not be loaded.',
    }
  }
}

export async function applySectionUpgrade(input: UpgradeRequest, expectedRevision: number): Promise<ActionResult> {
  const session = await currentSession()
  if (!session) return { ok: false, kind: 'error', message: 'Sign in before applying this update.' }
  try {
    const saved = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { page, section, target, plan } = await loadSectionUpgrade(client, input, true)
      if (String(expectedRevision) !== page.revision)
        throw new DomainError(
          'stale_revision',
          'The page changed after you reviewed this update.',
          Number(page.revision),
        )
      let revision = page.revision
      // Direct calls receive the same recovery checkpoint as the UI workflow.
      if (page.kind !== 'checkpoint') {
        revision = (
          await client.query<{ revision: string }>('SELECT revision FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
            input.pageId,
            revision,
            JSON.stringify(page.content),
            JSON.stringify(page.meta),
            'checkpoint',
            'Before section version update',
          ])
        ).rows[0]!.revision
      }
      const content = [...page.content]
      content[input.index] = { ...section, section_def_version: target.version, values: plan.values }
      return (
        await client.query<{ version_id: string; revision: string }>(
          'SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)',
          [
            input.pageId,
            revision,
            JSON.stringify(content),
            JSON.stringify(page.meta),
            'checkpoint',
            `Updated ${target.name} to version ${target.version}`,
          ],
        )
      ).rows[0]!
    })
    revalidatePath(`/pages/${input.pageId}`)
    return {
      ok: true,
      revision: Number(saved.revision),
      versionId: saved.version_id,
      message: 'Section updated in the draft. The live page is unchanged.',
    }
  } catch (error) {
    if (error instanceof DomainError && error.kind === 'stale_revision')
      return { ok: false, kind: 'conflict', currentRevision: error.currentRevision, message: error.message }
    return {
      ok: false,
      kind: 'error',
      message:
        error instanceof DomainError ? error.message : 'The update could not be confirmed. Reload before trying again.',
    }
  }
}
