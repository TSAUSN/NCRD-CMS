import { expect, it } from 'vitest'
import { draftSaveFailure } from './draft-save-failure.ts'
it('recognizes both deployment mismatch errors and gives a recovery instruction without internal details', () => {
  for (const detail of [
    'Server Action "private-id" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action',
    'Failed to find Server Action "private-id". This request might be from an older or newer deployment.',
  ]) {
    const failure = draftSaveFailure(new Error(detail))
    expect(failure.requiresReload).toBe(true)
    expect(failure.message).toContain('Automatic saving has stopped')
    expect(failure.message).toContain('recover your draft')
    expect(failure.message).not.toMatch(/private-id|https:|Server Action/)
  }
})
it('keeps ordinary save failures understandable without exposing a server exception', () => {
  expect(draftSaveFailure(new Error('SQL internal detail'))).toEqual({
    requiresReload: false,
    message: 'Could not save. Your work is still here. Check your connection and choose Save draft to try again.',
  })
  expect(draftSaveFailure(null).requiresReload).toBe(false)
})
