import { expect, it } from 'vitest'
import { confirmationState, signInMethod } from './sign-in-flow.ts'

const code = '11111111-1111-4111-8111-111111111111'
const base = { browserProof: true, providerError: false, method: 'microsoft' as const }

it('requires this browser’s proof for an OAuth code and rejects provider errors even alongside a valid code', () => {
  expect(confirmationState({ ...base, code }).valid).toBe(true)
  expect(confirmationState({ ...base, code, browserProof: false })).toMatchObject({ valid: false })
  expect(confirmationState({ ...base, code, providerError: true }).valid).toBe(false)
  expect(confirmationState({ ...base, code: 'malformed' }).valid).toBe(false)
})

it('keeps the legacy email token narrowly scoped and never treats method context as authentication', () => {
  const tokenHash = 'a'.repeat(64)
  expect(confirmationState({ ...base }).valid).toBe(false)
  expect(confirmationState({ ...base, tokenHash, type: 'email', browserProof: false }).valid).toBe(true)
  expect(confirmationState({ ...base, tokenHash, type: 'invite' }).valid).toBe(false)
  expect(confirmationState({ ...base, tokenHash, type: 'email', code: 'bad' }).valid).toBe(false)
  expect(signInMethod('untrusted')).toBe('email')
})

it('offers a Microsoft retry or password fallback without calling a canceled OAuth flow an expired email', () => {
  const state = confirmationState({ ...base, providerError: true })
  expect(state.message).toContain('Microsoft sign-in did not finish')
  expect(state.message).toContain('email and password')
  expect(state.message).not.toContain('expired')
  expect(confirmationState({ ...base, method: 'email', providerError: true }).message).toContain('already used')
})
