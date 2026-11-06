export type VersionPosture = {
  detail: 'Draft' | 'Live · changes not published' | 'Live'
  hasUnpublishedChanges: boolean
}

/** Saved versions can differ only in number links or other private bookkeeping.
 * The shared resolved comparison supplies that display fact; immutable versions
 * and the normal publication path remain unchanged. */
export function editorialPosture(page: {
  draft_version_id: string | null
  published_version_id: string | null
  no_visible_changes?: boolean
}): VersionPosture {
  if (page.published_version_id === null) {
    return { detail: 'Draft', hasUnpublishedChanges: true }
  }
  if (
    !page.no_visible_changes &&
    page.draft_version_id !== null &&
    page.draft_version_id !== page.published_version_id
  ) {
    return { detail: 'Live · changes not published', hasUnpublishedChanges: true }
  }
  return { detail: 'Live', hasUnpublishedChanges: false }
}
