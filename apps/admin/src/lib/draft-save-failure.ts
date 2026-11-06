/** A tab from an older deployment cannot retry its old server action. */
export function draftSaveFailure(error: unknown): { requiresReload: boolean; message: string } {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const requiresReload = /Server Action .*was not found|Failed to find Server Action/i.test(detail)
  return {
    requiresReload,
    message: requiresReload
      ? 'The CMS was updated while this page was open. Automatic saving has stopped. Your edits are still here; check the browser recovery copy, then reload this page and recover your draft before continuing.'
      : 'Could not save. Your work is still here. Check your connection and choose Save draft to try again.',
  }
}
