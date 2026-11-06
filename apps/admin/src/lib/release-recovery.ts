import { asUser } from '@cms/platform'
import type { ReleaseItem, ReleaseType } from './releases.ts'

export type RecoveryCheckpoint = {
  key: string
  type: ReleaseType
  id: string
  label: string
  versionId: string | null
  secondaryVersionId?: string | null
  /** Record batches retain every immutable entry version, including archived records. */
  entryVersionIds?: string[]
}

export type RecoveryReviewItem = {
  key: string
  type: ReleaseType
  id: string
  label: string
  wasUnpublished: boolean
  beforeVersionId: string | null
  beforeSecondaryVersionId?: string | null
  currentRevision: string
  currentDraftVersionId: string | null
  publishedVersionId: string | null
  laterDraft: boolean
}

export type RecoveryReview =
  | {
      releaseId: string
      siteId: string
      available: false
      reason: string
    }
  | {
      releaseId: string
      siteId: string
      available: true
      wasPrivate: boolean
      items: RecoveryReviewItem[]
      /** Opaque CAS token. Scope and target versions are re-derived by the database. */
      expectedState: unknown
    }

export type PreparedRecovery = {
  recoveryId: string
  siteId: string
  sourceReleaseId: string
  items: ReleaseItem[]
  preservedDrafts: RecoveryCheckpoint[]
  plannedReleaseId?: string | null
}

export function getReleaseRecoveryReview(userId: string, releaseId: string): Promise<RecoveryReview> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<{ review: RecoveryReview }>('SELECT app.review_site_release_recovery($1) AS review', [
          releaseId,
        ])
      ).rows[0]!.review,
  )
}

export function prepareReleaseRecovery(
  userId: string,
  requestId: string,
  releaseId: string,
  expectedState: unknown,
): Promise<PreparedRecovery> {
  return asUser(
    { userId, requestId },
    async client =>
      (
        await client.query<{ recovery: PreparedRecovery }>(
          'SELECT app.prepare_site_release_recovery($1,$2,$3) AS recovery',
          [requestId, releaseId, JSON.stringify(expectedState)],
        )
      ).rows[0]!.recovery,
  )
}

/** Recover a saved preparation after reload or a lost response. Its immutable
 * choices remain subject to the same CAS checks before planning/publication. */
export function getPreparedReleaseRecovery(userId: string, sourceReleaseId: string): Promise<PreparedRecovery | null> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<{ recovery: PreparedRecovery | null }>(
          'SELECT app.read_prepared_site_release_recovery($1) AS recovery',
          [sourceReleaseId],
        )
      ).rows[0]!.recovery,
  )
}
