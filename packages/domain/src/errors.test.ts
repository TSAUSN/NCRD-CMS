import { describe, expect, it } from 'vitest'
import { DomainError, fromSqlError, mapErrors } from './errors.ts'
import { asConflict, isMonotonic } from './revision.ts'

describe('SQLSTATE mapping', () => {
  it.each([
    ['CMS01', 'stale_revision'],
    ['CMS02', 'not_authorized'],
    ['CMS03', 'not_found'],
    ['CMS04', 'invalid_state'],
    ['CMS05', 'trusted_code_unapproved'],
    ['42501', 'not_authorized'],
  ])('maps %s to %s', (code, kind) => {
    expect(fromSqlError({ code, message: 'x' })?.kind).toBe(kind)
  })

  it('carries the head revision out of a conflict so the editor can diff', () => {
    const error = fromSqlError({ code: 'CMS01', message: 'stale', detail: '7' })
    expect(error?.currentRevision).toBe(7)
  })

  it('reads both collection revision domains from structured SQL detail', () => {
    expect(fromSqlError({ code: 'CMS01', detail: '{"revision":12}' })?.currentRevision).toBe(12)
    expect(fromSqlError({ code: 'CMS01', detail: '{"entry_revision":19}' })?.currentRevision).toBe(19)
    expect(fromSqlError({ code: 'CMS01', detail: '{"something_else":3}' })?.currentRevision).toBeUndefined()
  })

  it('leaves an unrelated error alone rather than mislabelling it', () => {
    expect(fromSqlError({ code: '08006', message: 'connection failure' })).toBeNull()
    expect(fromSqlError(new Error('boom'))).toBeNull()
  })

  it('rethrows unrelated errors unchanged through mapErrors', async () => {
    const boom = new Error('boom')
    await expect(
      mapErrors(async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
  })

  it('converts a database refusal into a domain error through mapErrors', async () => {
    await expect(
      mapErrors(async () => {
        throw { code: 'CMS02', message: 'nope' }
      }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('conflicts never discard the local draft', () => {
  it('builds a conflict that keeps the draft and names both revisions', () => {
    const conflict = asConflict(new DomainError('stale_revision', 'stale', 9), 4)
    expect(conflict).toEqual({ kind: 'stale_revision', expectedRevision: 4, currentRevision: 9, keepLocalDraft: true })
  })

  it('is not a conflict when the failure was something else', () => {
    expect(asConflict(new DomainError('not_authorized', 'no'), 1)).toBeNull()
  })

  it('recognises a monotonic advance', () => {
    expect(isMonotonic(3, 4)).toBe(true)
    expect(isMonotonic(3, 5)).toBe(false)
    expect(isMonotonic(3, 3)).toBe(false)
  })
})
