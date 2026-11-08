// The database compares revisions in the command transaction. All editor surfaces share this conflict shape.
import { DomainError } from './errors.ts'

export type Revision = number

export type CasRequest<T> = {
  /** The revision the editor loaded. */
  expectedRevision: Revision
  payload: T
}

export type CasResult = {
  revision: Revision
  versionId: string
}

export type Conflict = {
  kind: 'stale_revision'
  expectedRevision: Revision
  currentRevision: Revision | undefined
  /** The local draft is never discarded on conflict (SPEC §6.3). */
  keepLocalDraft: true
}

export function asConflict(error: unknown, expectedRevision: Revision): Conflict | null {
  if (error instanceof DomainError && error.kind === 'stale_revision') {
    return { kind: 'stale_revision', expectedRevision, currentRevision: error.currentRevision, keepLocalDraft: true }
  }
  return null
}

export function isMonotonic(previous: Revision, next: Revision): boolean {
  return Number.isInteger(previous) && Number.isInteger(next) && next === previous + 1
}
