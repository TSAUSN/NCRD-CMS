import { deepEqual, type EditorSection } from './editing.ts'

export type ReviewStatus = 'open' | 'approved' | 'rejected' | 'superseded'

export type ReviewChangeSummary = {
  firstPublication: boolean
  submittedSections: number
  addedSections: number
  removedSections: number
  changedSections: number
  reordered: boolean
  changedMetadata: string[]
}

/**
 * A calm, truthful overview for the inbox card.
 *
 * It is deliberately a summary rather than a pretend field diff. A section
 * instance has no durable per-page id yet, so duplicate definition types
 * cannot be paired across arbitrary moves without guessing. The exact
 * submitted and live versions remain available side by side in the preview.
 */
export function summarizePageReview(input: {
  submittedSections: EditorSection[]
  submittedMeta: Record<string, unknown>
  liveSections: EditorSection[] | null
  liveMeta: Record<string, unknown> | null
}): ReviewChangeSummary {
  const submitted = input.submittedSections
  const live = input.liveSections
  if (live === null) {
    return {
      firstPublication: true,
      submittedSections: submitted.length,
      addedSections: submitted.length,
      removedSections: 0,
      changedSections: 0,
      reordered: false,
      changedMetadata: changedKeys({}, input.submittedMeta),
    }
  }

  const submittedKinds = submitted.map(section => section.section_def_id)
  const liveKinds = live.map(section => section.section_def_id)
  const reordered =
    submitted.length === live.length && sameMultiset(submittedKinds, liveKinds) && !deepEqual(submittedKinds, liveKinds)
  const comparable = Math.min(submitted.length, live.length)
  let changedSections = 0
  for (let index = 0; index < comparable; index += 1) {
    if (!deepEqual(submitted[index], live[index])) changedSections += 1
  }

  return {
    firstPublication: false,
    submittedSections: submitted.length,
    addedSections: Math.max(0, submitted.length - live.length),
    removedSections: Math.max(0, live.length - submitted.length),
    changedSections,
    reordered,
    changedMetadata: changedKeys(input.liveMeta ?? {}, input.submittedMeta),
  }
}

export function reviewStatusLabel(status: ReviewStatus): string {
  switch (status) {
    case 'open':
      return 'Waiting for review'
    case 'approved':
      return 'Approved and published'
    case 'rejected':
      return 'Changes requested'
    case 'superseded':
      return 'Replaced by newer work'
  }
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => !deepEqual(before[key], after[key]))
    .sort()
}

function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const counts = new Map<string, number>()
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1)
  for (const value of right) {
    const count = counts.get(value) ?? 0
    if (count === 0) return false
    if (count === 1) counts.delete(value)
    else counts.set(value, count - 1)
  }
  return counts.size === 0
}
